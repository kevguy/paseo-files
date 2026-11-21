import {useEffect,useRef,useState} from 'react';
import {KeyboardAvoidingView,Platform,ScrollView,Text,TextInput,View} from 'react-native';
import {copyText} from '@getpaseo/plugin/client/ui';
import type {PluginTheme} from '@getpaseo/plugin';
import {Button,Notice,mono} from './ui';
import {DesktopEditor,type EditorHandle} from './web';
import {useEditorInsets} from './keyboard';
import {Code,Markdown} from './markdown';
import {nextMatch,prefixLines,wrap,type Selection,type Edit} from '../shared/edit';
export type Document = {path:string;text:string;revision:string};
export type Draft = Document & {baseText:string};
export function Editor({draft,theme,compact,busy,error,onChange,onSave,onReload,onBack,onLink,initialLine,web,vimMode,onVimChange}: {draft:Draft;theme:PluginTheme;compact:boolean;busy:boolean;error:string;onChange:(text:string)=>void;onSave:()=>void;onReload:()=>void;onBack?:()=>void;onLink:(href:string,wiki?:boolean)=>void;initialLine?:number;web:boolean;vimMode:boolean;onVimChange:(enabled:boolean)=>void}){
  const insets=useEditorInsets();
  const ext=draft.path.split('.').pop()?.toLowerCase()??'';
  const markdown=['md','markdown','mdx'].includes(ext);
  const [mode,setMode]=useState<'read'|'edit'|'split'>(initialLine?'edit':markdown?'read':'edit');
  const [selection,setSelection]=useState<Selection>({start:0,end:0});
  const [find,setFind]=useState('');const [findMessage,setFindMessage]=useState('');const [finding,setFinding]=useState(false);const [message,setMessage]=useState('');const [reloadConfirm,setReloadConfirm]=useState(false);
  const desktop=useRef<EditorHandle>(null);const [vimStatus,setVimStatus]=useState('normal');
  const input=useRef<TextInput>(null);const undo=useRef<string[]>([]),redo=useRef<string[]>([]);const lastTyping=useRef(0);
  const dirty=draft.text!==draft.baseText;
  useEffect(()=>{if(mode==='read')input.current?.blur();},[mode]);
  useEffect(()=>{setFindMessage('');},[draft.text]);
  function changeMode(next:typeof mode){setFindMessage('');setMode(next);}
  useEffect(()=>{if(initialLine){const start=draft.text.split('\n').slice(0,Math.max(0,initialLine-1)).join('\n').length+(initialLine>1?1:0);setSelection({start,end:start});}},[]);
  function remember(){undo.current.push(draft.text);while(undo.current.length>80||undo.current.reduce((n,x)=>n+x.length,0)>2_000_000)undo.current.shift();redo.current=[];}
  function change(text:string,group=false){if(!group||Date.now()-lastTyping.current>700)remember();lastTyping.current=Date.now();onChange(text);setMessage('');}
  function edit(value:Edit){remember();onChange(value.text);setSelection(value.selection);setMode('edit');if(web)desktop.current?.focus();else input.current?.focus();}
  function history(direction:'undo'|'redo'){if(web){desktop.current?.[direction]();return;}const source=direction==='undo'?undo:redo,target=direction==='undo'?redo:undo;const text=source.current.pop();if(text===undefined)return;target.current.push(draft.text);onChange(text);setSelection(s=>({start:Math.min(s.start,text.length),end:Math.min(s.end,text.length)}));setMode('edit');}
  const c=theme.colors;
  const line=draft.text.slice(0,selection.start).split('\n').length;
  const column=selection.start-(draft.text.lastIndexOf('\n',selection.start-1)+1)+1;
  function findNext(){if(!find){setFindMessage('');return;}const hit=nextMatch(draft.text,find,selection.end);if(hit){setMode('edit');setSelection(hit);setFindMessage('Match selected');if(web)desktop.current?.focus();else input.current?.focus();}else setFindMessage('No matches');}
  async function copy(){try{await copyText(draft.text);setMessage('Copied');}catch(e){setMessage(`Copy failed: ${String(e)}`);}}
  const reading=<ScrollView style={{flex:1}} contentContainerStyle={{padding:compact?18:28,paddingBottom:70}} keyboardShouldPersistTaps="handled">{markdown?<Markdown text={draft.text} theme={theme} onLink={onLink}/>:<Code text={draft.text} language={ext} theme={theme}/>}</ScrollView>;
  const editing=web?<DesktopEditor ref={desktop} value={draft.text} selection={selection} onChange={text=>onChange(text)} onSelectionChange={setSelection} onSave={onSave} language={ext} theme={theme} readOnly={busy} vimMode={vimMode} onVimMode={setVimStatus}/>:<TextInput ref={input} accessibilityLabel="File contents" testID="file-editor" value={draft.text} onChangeText={text=>change(draft.baseText.includes('\r\n')?text.replace(/\r?\n/g,'\r\n'):text,true)} editable={!busy} multiline autoCorrect={false} spellCheck={false} autoCapitalize="none" textAlignVertical="top" selection={selection} onSelectionChange={e=>setSelection(e.nativeEvent.selection)} style={{flex:1,minHeight:180,padding:18,color:c.foreground,backgroundColor:c.surface0,fontFamily:mono,fontSize:16,lineHeight:25}} onKeyPress={e=>{if(Platform.OS==='web'&&e.nativeEvent.key==='Tab'){e.preventDefault();edit(wrap(draft.text,selection,'  ',''));}}}/>;
  return <KeyboardAvoidingView style={{flex:1,backgroundColor:c.surface0}} behavior={Platform.OS==='ios'?'padding':undefined}><View ref={insets.ref} onLayout={insets.onLayout} style={{flex:1,paddingBottom:insets.bottom}}>
    <View style={{paddingHorizontal:12,paddingTop:10,gap:8,borderBottomWidth:1,borderBottomColor:c.border}}>
      <View style={{flexDirection:'row',alignItems:'center',gap:8}}>{onBack&&<Button theme={theme} onPress={onBack} label="Back to files">← Files</Button>}<Text numberOfLines={2} selectable style={{flex:1,color:c.foreground,fontSize:15,fontWeight:'600'}}>{draft.path.split('/').pop()}</Text><Button theme={theme} selected disabled={busy||!dirty} onPress={onSave}>{busy?'Saving…':'Save'}</Button></View>
      <Text numberOfLines={2} selectable style={{color:c.foregroundMuted,fontSize:12}}>{draft.path} · {dirty?'Unsaved changes':'Saved'}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{gap:6,paddingBottom:9}}>
        <Button theme={theme} selected={mode==='read'} onPress={()=>changeMode('read')}>{markdown?'Read':'Syntax'}</Button><Button theme={theme} selected={mode==='edit'} onPress={()=>changeMode('edit')}>Edit</Button>{!compact&&<Button theme={theme} selected={mode==='split'} onPress={()=>changeMode('split')}>Split</Button>}
        <>{web&&<Button theme={theme} selected={vimMode} onPress={()=>{onVimChange(!vimMode);setMode('edit');}}>Vim {vimMode?'on':'off'}</Button>}</><Button theme={theme} selected={finding} onPress={()=>{setFinding(!finding);setFindMessage('');}}>Find</Button><Button theme={theme} disabled={busy||(!web&&!undo.current.length)||(web&&mode==='read')} onPress={()=>history('undo')}>Undo</Button><Button theme={theme} disabled={busy||(!web&&!redo.current.length)||(web&&mode==='read')} onPress={()=>history('redo')}>Redo</Button><Button theme={theme} onPress={()=>void copy()}>Copy</Button><Button theme={theme} disabled={busy} onPress={()=>dirty?setReloadConfirm(true):onReload()}>Reload</Button>
      </ScrollView>
      {mode!=='read'&&<ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{gap:6,paddingBottom:9}}>
        {markdown?<><Button theme={theme} disabled={busy} label="Bold" onPress={()=>edit(wrap(draft.text,selection,'**'))}>B</Button><Button theme={theme} disabled={busy} label="Italic" onPress={()=>edit(wrap(draft.text,selection,'*'))}>Italic</Button><Button theme={theme} disabled={busy} onPress={()=>edit(prefixLines(draft.text,selection,'## '))}>Heading</Button><Button theme={theme} disabled={busy} onPress={()=>edit(prefixLines(draft.text,selection,'- '))}>List</Button><Button theme={theme} disabled={busy} onPress={()=>edit(prefixLines(draft.text,selection,'- [ ] '))}>Task</Button><Button theme={theme} disabled={busy} onPress={()=>edit(wrap(draft.text,selection,'[[',']]'))}>Note link</Button><Button theme={theme} disabled={busy} onPress={()=>edit(wrap(draft.text,selection,'[','](url)'))}>Link</Button><Button theme={theme} disabled={busy} onPress={()=>edit(wrap(draft.text,selection,'`'))}>Code</Button><Button theme={theme} disabled={busy} onPress={()=>edit(prefixLines(draft.text,selection,'> '))}>Quote</Button></>:<><Button theme={theme} disabled={busy} onPress={()=>edit(prefixLines(draft.text,selection,'  '))}>Indent</Button>{['{','[','('].map((x,i)=><Button key={x} theme={theme} disabled={busy} onPress={()=>edit(wrap(draft.text,selection,x,['}',']',')'][i]))}>{x}{['}',']',')'][i]}</Button>)}{ext==='json'&&<Button theme={theme} disabled={busy} onPress={()=>{try{const eol=draft.text.includes('\r\n')?'\r\n':'\n';change((draft.text.startsWith('\uFEFF')?'\uFEFF':'')+(JSON.stringify(JSON.parse(draft.text.replace(/^\uFEFF/,'')),null,2)+'\n').replace(/\n/g,eol));setMessage('JSON formatted; save to apply');}catch(e){setMessage(`Invalid JSON: ${String(e)}`);}}}>Format JSON</Button>}</>}
      </ScrollView>}
      {finding&&<View style={{flexDirection:'row',gap:8,paddingBottom:8}}><TextInput accessibilityLabel="Find in file" placeholder="Find in this file" placeholderTextColor={c.foregroundMuted} value={find} onChangeText={value=>{setFind(value);setFindMessage('');}} onSubmitEditing={findNext} autoCorrect={false} autoCapitalize="none" style={{flex:1,color:c.foreground,borderWidth:1,borderColor:c.border,borderRadius:8,padding:10}}/><Button theme={theme} onPress={findNext} disabled={!find}>Next</Button></View>}
      {reloadConfirm&&<Notice theme={theme}>Reload discards this draft. Copy it first if you want to keep it.<View style={{flexDirection:'row',gap:8}}><Button theme={theme} onPress={()=>{setReloadConfirm(false);onReload();}}>Discard and reload</Button><Button theme={theme} onPress={()=>setReloadConfirm(false)}>Keep editing</Button></View></Notice>}
      {!!error&&<Notice theme={theme} danger>{error} Your draft is kept. Copy it or reload the latest file before merging your changes.</Notice>}
      {finding&&!!findMessage&&<Text accessibilityLiveRegion="polite" style={{color:c.foregroundMuted,paddingBottom:8}}>{findMessage}</Text>}
      {!!message&&<Text accessibilityLiveRegion="polite" style={{color:c.foregroundMuted,paddingBottom:8}}>{message}</Text>}
    </View>
    <View style={{flex:1,flexDirection:'row'}}>
      <View style={{flex:mode==='read'?0:1,display:mode==='read'?'none':'flex',borderRightWidth:mode==='split'?1:0,borderColor:c.border}}>{editing}</View>
      <View style={{flex:mode==='edit'?0:1,display:mode==='edit'?'none':'flex'}}>{mode==='edit'?null:reading}</View>
    </View>
    <Text style={{color:c.foregroundMuted,backgroundColor:c.surface1,paddingHorizontal:14,paddingVertical:7,fontSize:12}}>{web&&vimMode?`VIM ${vimStatus.toUpperCase()} · `:''}Ln {line}, Col {column} · {draft.text.length.toLocaleString()} characters · {draft.text.includes('\r\n')?'CRLF':'LF'} · UTF-8</Text>
  </View></KeyboardAvoidingView>;
}
