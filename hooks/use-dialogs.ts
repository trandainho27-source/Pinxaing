'use client';
import {useEffect, useRef} from 'react';
// Keep keyboard focus in the top dialog and return it to the triggering control.
export function useDialogs(key:string, close:()=>void) {
    const onClose=useRef(close);onClose.current=close;
    useEffect(()=>{
        if(!key.replaceAll('|','')) return;
        const previous=document.activeElement as HTMLElement|null, overflow=document.body.style.overflow;
        document.body.style.overflow='hidden';
        const controls=(dialog:Element)=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(e=>e.getClientRects().length);
        const dialog=()=>Array.from(document.querySelectorAll('[role="dialog"]')).at(-1);
        const frame=requestAnimationFrame(()=>{const d=dialog();if(d)controls(d)[0]?.focus();});
        const handler=(event:KeyboardEvent)=>{
            if(event.key==='Escape'){event.preventDefault();onClose.current();return;}
            if(event.key!=='Tab')return;
            const d=dialog();if(!d)return;const list=controls(d),first=list[0],last=list.at(-1);
            if(!first){event.preventDefault();return;}
            if(event.shiftKey && (document.activeElement===first || !d.contains(document.activeElement))){event.preventDefault();last?.focus();}
            else if(!event.shiftKey && (document.activeElement===last || !d.contains(document.activeElement))){event.preventDefault();first.focus();}
        };
        document.addEventListener('keydown',handler);
        return()=>{cancelAnimationFrame(frame);document.body.style.overflow=overflow;document.removeEventListener('keydown',handler);previous?.focus();};
    },[key]);
}
