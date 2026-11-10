export function bindDirectionInk(canvas,{start,move,end}){
 let activeTouch=null,activePointer=null;
 const nativeTouch='ontouchstart' in canvas;
 function finish(){
  activeTouch=null;
  activePointer=null;
  end();
 }
 const stop=e=>e.preventDefault();
 canvas.addEventListener('contextmenu',stop);
 canvas.addEventListener('selectstart',stop);
 function touchEvent(type,handler){
  canvas.addEventListener(type,e=>{
   if(e.cancelable)e.preventDefault();
   handler(e);
  },{passive:false});
 }
 touchEvent('touchstart',e=>{
  if(activeTouch!==null)return;
  const touch=e.changedTouches[0];
  if(activePointer!==null){
   if(touch.touchType!=='stylus')return;
   activePointer=null;
   activeTouch=touch.identifier;
   return;
  }
  activeTouch=touch.identifier;
  start(touch);
 });
 touchEvent('touchmove',e=>{
  const touch=Array.from(e.changedTouches).find(t=>t.identifier===activeTouch);
  if(touch)move(touch);
 });
 for(const type of ['touchend','touchcancel']){
  touchEvent(type,e=>{
   const touch=Array.from(e.changedTouches).find(t=>t.identifier===activeTouch);
   if(!touch)return;
   if(type==='touchend')move(touch);
   finish();
  });
 }
 canvas.addEventListener('pointerdown',e=>{
  if(nativeTouch&&e.pointerType==='touch'||activeTouch!==null||activePointer!==null||e.button!==0)return;

  activePointer=e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  start(e);
 });
 canvas.addEventListener('pointermove',e=>{if(e.pointerId===activePointer)move(e);});
 for(const type of ['pointerup','pointercancel','lostpointercapture']){
  canvas.addEventListener(type,e=>{
   if(e.pointerId!==activePointer)return;
   if(type==='pointerup')move(e);
   finish();
  });
 }
}

