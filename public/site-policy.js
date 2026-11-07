const printButton=document.getElementById('printPolicy');
if(printButton){printButton.hidden=false;printButton.addEventListener('click',()=>window.print());}
