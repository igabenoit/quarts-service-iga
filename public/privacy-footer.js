if(!document.querySelector('[data-privacy-contact]')){
 const css=document.createElement('link');css.rel='stylesheet';css.href='/privacy-footer.css';document.head.append(css);
 const footer=document.createElement('footer');footer.className='privacy-contact';footer.dataset.privacyContact='1';
 const text=document.createElement('span');text.textContent='Protection des renseignements personnels : Marc-André Benoit, copropriétaire et directeur général. ';
 const mail=document.createElement('a');mail.href='mailto:Marc-Andre.benoit@sobeys.com';mail.textContent='Marc-Andre.benoit@sobeys.com';
 const phone=document.createElement('span');phone.textContent=' · 450-773-7582 · ';
 const policy=document.createElement('a');policy.href='/dossiers-employes#politique';policy.textContent='Politique de confidentialité';
 footer.append(text,mail,phone,policy);document.body.append(footer);
}
