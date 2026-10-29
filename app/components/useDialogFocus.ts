'use client';

import {useEffect, useRef} from 'react';

/** Keep modal keyboard interaction inside the dialog and restore its trigger. */
export function useDialogFocus(open:boolean, onClose:()=>void) {
  const dialogRef=useRef<HTMLElement>(null);
  const closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    if(!open||!dialogRef.current)return;
    const dialog=dialogRef.current;
    const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const background=new Map<HTMLElement,boolean>();
    let branch:HTMLElement=dialog;
    while(branch.parentElement){
      for(const sibling of branch.parentElement.children){
        if(sibling!==branch&&sibling instanceof HTMLElement){background.set(sibling,sibling.inert);sibling.inert=true;}
      }
      branch=branch.parentElement;
      if(branch===document.body)break;
    }
    const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')).filter(element=>element.getClientRects().length>0&&!element.closest('[inert]'));
    const focusFirst=()=>{(focusable()[0]||dialog).focus({preventScroll:true});};
    focusFirst();
    function onKey(event:KeyboardEvent){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeRef.current();return;}
      if(event.key!=='Tab')return;
      const items=focusable(),first=items[0],last=items.at(-1);
      if(!first||!last){event.preventDefault();dialog.focus();return;}
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    }
    function onFocus(event:FocusEvent){if(event.target instanceof Node&&!dialog.contains(event.target))focusFirst();}
    document.addEventListener('keydown',onKey,true);
    document.addEventListener('focusin',onFocus);
    return()=>{
      document.removeEventListener('keydown',onKey,true);
      document.removeEventListener('focusin',onFocus);
      document.body.style.overflow=previousOverflow;
      for(const [element,previous] of background)element.inert=previous;
      if(trigger?.isConnected)trigger.focus({preventScroll:true});
      else {const main=document.getElementById('main');if(main){const old=main.getAttribute('tabindex');main.setAttribute('tabindex','-1');main.focus({preventScroll:true});if(old===null)main.removeAttribute('tabindex');else main.setAttribute('tabindex',old);}}
    };
  },[open]);
  return dialogRef;
}
