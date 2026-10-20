export function createPushControls({api}){
  const $=s=>document.querySelector(s),button=$('#enablePush'),disable=$('#disablePush'),test=$('#testPush'),status=$('#pushStatus');
  let registration=null,publicKey=null,busy=false,initialized=false;
  const supported=()=>('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window);
  const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const say=text=>status.textContent=text;
  const locked=value=>{busy=value;button.disabled=value;disable.disabled=value;test.disabled=value;};
  function display(enabled){
    button.hidden=enabled;disable.hidden=!enabled;test.hidden=!enabled;
  }
  async function refresh(){
    if(busy)return;
    if(ios()&&!standalone()){
      button.disabled=true;say('Sur iPhone ou iPad : ajoute cette page à l’écran d’accueil depuis le menu Partager de Safari, puis ouvre ce raccourci pour activer les notifications.');return;
    }
    if(!supported()){button.disabled=true;say('Ce navigateur ne permet pas les notifications Web. Essaie Safari sur iPhone récent, ou Chrome sur Android.');return;}
    locked(true);
    try{
      const settings=await api('/api/service-chat/push');publicKey=settings.publicKey;
      registration=await navigator.serviceWorker.register('/service-chat-sw.js',{scope:'/discussion'});
      await navigator.serviceWorker.ready;
      const subscription=await registration.pushManager.getSubscription();
      const enabled=settings.enabled&&Notification.permission==='granted'&&!!subscription;
      display(enabled);
      say(enabled?'Notifications activées sur cet appareil, même lorsque le site est fermé.':Notification.permission==='denied'?'Les notifications sont bloquées. Autorise-les dans les réglages du navigateur ou du téléphone, puis recharge cette page.':'Active les notifications sur cet appareil pour recevoir les nouveaux messages.');
      initialized=true;
    }catch(error){say(error.message||'Impossible de préparer les notifications. Réessaie.');}
    finally{locked(false);}
  }
  button.onclick=async()=>{
    if(busy)return;
    // Request permission directly from this click, before any network or registration await.
    const permissionPromise=supported()?Notification.requestPermission():Promise.resolve('denied');
    locked(true);
    try{
      if(await permissionPromise!=='granted'){say('Notifications non autorisées. Tu peux continuer à utiliser la discussion.');return;}
      if(!registration||!publicKey)throw Error('Recharge cette page pour préparer les notifications.');
      let subscription=await registration.pushManager.getSubscription();
      const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      if(subscription?.options.applicationServerKey){
        const current=new Uint8Array(subscription.options.applicationServerKey);
        if(current.length!==bytes.length||current.some((value,i)=>value!==bytes[i])){await subscription.unsubscribe();subscription=null;}
      }
      subscription=subscription||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      await api('/api/service-chat/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription.toJSON())});
      display(true);say('Notifications activées. Utilise « Tester » pour vérifier la réception sur ce téléphone.');
    }catch(error){say(error.message||'Activation impossible. Réessaie.');}
    finally{locked(false);}
  };
  disable.onclick=async()=>{
    if(busy)return;locked(true);
    try{
      // Revoke on the server first, including any queued notifications.
      await api('/api/service-chat/push',{method:'DELETE'});
      const subscription=await registration?.pushManager.getSubscription();if(subscription)await subscription.unsubscribe();
      display(false);say('Notifications désactivées sur cet appareil.');
    }catch(error){say(error.message||'Désactivation impossible. Réessaie.');}
    finally{locked(false);}
  };
  test.onclick=async()=>{
    if(busy)return;locked(true);
    try{await api('/api/service-chat/push/test',{method:'POST'});say('Test confié au service de notifications. Vérifie que la notification apparaît sur ton appareil.');}
    catch(error){say(error.message||'Test impossible. Réessaie.');}
    finally{locked(false);}
  };
  return {refresh(){if(!initialized)void refresh();},reset(){initialized=false;display(false);}};
}
