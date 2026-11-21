import {useCallback,useEffect,useRef,useState} from 'react';
import {Keyboard,Platform,useWindowDimensions,type View} from 'react-native';
import {useBottomInset} from './doc-viewer/use-bottom-inset';
export function keyboardOverlap(bottom:number|null,keyboardTop:number|null){return bottom===null||keyboardTop===null?0:Math.max(0,bottom-keyboardTop);}
// Measure only this plugin view. If Paseo resizes it above the keyboard, overlap becomes zero.
export function useEditorInsets(){
 const safe=useBottomInset();const frame=useRef<number|null>(null);const keyboard=useRef<number|null>(null);const [overlap,setOverlap]=useState(0);const window=useWindowDimensions();
 const update=useCallback(()=>setOverlap(keyboardOverlap(frame.current,keyboard.current)),[]);
 const onLayout=useCallback(()=>{safe.onLayout();safe.ref.current?.measureInWindow((_x,y,_width,height)=>{frame.current=y+height;update();});},[safe.onLayout,update]);
 useEffect(()=>{if(Platform.OS!=='android')return;const show=Keyboard.addListener('keyboardDidShow',e=>{keyboard.current=e.endCoordinates.screenY;onLayout();});const hide=Keyboard.addListener('keyboardDidHide',()=>{keyboard.current=null;update();});return()=>{show.remove();hide.remove();};},[onLayout,update]);
 useEffect(onLayout,[onLayout,window.height,window.width]);
 return {ref:safe.ref as React.RefObject<View|null>,onLayout,bottom:Math.max(safe.bottomInset,overlap)};
}
