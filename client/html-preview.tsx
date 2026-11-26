import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ActivityIndicator,Platform,Text,View} from 'react-native';
import {DocumentFrame} from '@getpaseo/plugin/client/ui';
import type {PluginFile} from '@getpaseo/plugin/client';
import type {PluginTheme} from '@getpaseo/plugin';
import {HtmlFrame,useDebouncedValue} from './html-frame';
import {HTML_PREVIEW_DEBOUNCE_MS} from '../shared/html-preview';

// Whether a rendered preview can be shown here. The web renders the draft itself; native apps
// render the saved file through Paseo's DocumentFrame, so they need the panel's file handle.
export function canPreviewHtml(file:PluginFile|undefined):boolean{return Platform.OS==='web'||!!file;}

export function HtmlPreview({text,baseText,revision,file,theme,fallback}:{text:string;baseText:string;revision:string;file?:PluginFile;theme:PluginTheme;fallback:ReactNode}){
  if(Platform.OS==='web')return <WebPreview text={text} theme={theme}/>;
  if(!file)return <>{fallback}</>;
  return <NativePreview file={file} text={text} dirty={text!==baseText} baseText={baseText} revision={revision} theme={theme} fallback={fallback}/>;
}

function Note({theme,children}:{theme:PluginTheme;children:string}){return <Text accessibilityLiveRegion="polite" style={{color:theme.colors.foregroundMuted,backgroundColor:theme.colors.surface1,paddingHorizontal:14,paddingVertical:7,fontSize:12}}>{children}</Text>;}

// The current draft, unsaved edits included; a pause in typing reloads the frame.
function WebPreview({text,theme}:{text:string;theme:PluginTheme}){const html=useDebouncedValue(text,HTML_PREVIEW_DEBOUNCE_MS);return <View style={{flex:1}}><HtmlFrame html={html} fallback={problem=><Note theme={theme}>{problem==='too-large'?'Too large to preview here; use Source':'This page could not be previewed; use Source'}</Note>}/></View>;}

// DocumentFrame shows the file on disk with JavaScript off. The URL is fetched again after a save
// (a new revision) and when the file changes on disk; each load gets a new frame. Each load also
// reads the text, so the panel can say when disk no longer matches what the editor loaded.
// Disk text equal to the current draft is not a change: a save writes it before the panel hears
// the new revision, and the watcher may fire in between.
function NativePreview({file,text,dirty,baseText,revision,theme,fallback}:{file:PluginFile;text:string;dirty:boolean;baseText:string;revision:string;theme:PluginTheme;fallback:ReactNode}){
  const [state,setState]=useState<{url:string;load:number;changed:boolean}|'loading'|'failed'>('loading');
  const draft=useRef(text);draft.current=text;
  useEffect(()=>{let alive=true,generation=0;
    // readText drops a byte order mark; the editor's text keeps it.
    const loaded=baseText.replace(/^\uFEFF/,'');
    const load=()=>{const current=++generation;
      const changed=file.readText().then(disk=>disk!==loaded&&disk!==draft.current.replace(/^\uFEFF/,''),()=>false);
      file.url().then(async url=>{const differs=await changed;if(alive&&current===generation)setState(s=>({url,changed:differs,load:typeof s==='object'?s.load+1:0}));},()=>{if(alive&&current===generation)setState('failed');});};
    load();const unwatch=file.watch(event=>{if(event.type==='changed')load();});
    return()=>{alive=false;unwatch();};
  },[file,revision,baseText]);
  if(state==='failed')return <>{fallback}</>;
  if(state==='loading')return <ActivityIndicator style={{marginTop:24}} color={theme.colors.accent}/>;
  return <View style={{flex:1}}>{state.changed?<Note theme={theme}>The file changed on disk; Preview shows the new version. Reload to edit it.</Note>:dirty&&<Note theme={theme}>Preview shows the saved file</Note>}<DocumentFrame key={state.load} url={state.url} testID="html-preview-frame"/></View>;
}
