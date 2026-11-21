import {useMemo,useState} from 'react';
import type {ReactNode} from 'react';
import {Text,View,ScrollView} from 'react-native';
import type {PluginTheme} from '@getpaseo/plugin';
import {marked,type Token,type Tokens} from 'marked';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import {mono} from './ui';
marked.use({gfm:true,extensions:[{name:'wikilink',level:'inline',start:(src:string)=>src.indexOf('[['),tokenizer(src:string){const match=/^\[\[([^\]\n]+)\]\]/.exec(src);if(!match)return; const [href,label]=match[1].split('|');return {type:'wikilink',raw:match[0],href,text:label??href};}}]});
export function Code({text,language,theme}: {text:string;language:string;theme:PluginTheme}){
  const parts=useMemo(()=>{const aliases:Record<string,string>={js:'javascript',ts:'typescript',py:'python',yml:'yaml',sh:'bash',html:'markup'};const grammar=Prism.languages[aliases[language]??language];return grammar&&text.length<40000?Prism.tokenize(text,grammar):[text];},[text,language]);
  function render(part:string|Prism.Token,i:number):ReactNode{if(typeof part==='string')return part;const color=['comment','prolog'].includes(part.type)?theme.colors.foregroundMuted:['string','attr-value','number','boolean'].includes(part.type)?theme.colors.statusSuccess:theme.colors.accent;return <Text key={i} style={{color}}>{Array.isArray(part.content)?part.content.map(render):typeof part.content==='string'?part.content:render(part.content,0)}</Text>;}
  return <Text selectable style={{fontFamily:mono,fontSize:14,lineHeight:22,color:theme.colors.foreground}}>{parts.map(render)}</Text>;
}
export function Markdown({text,theme,onLink}: {text:string;theme:PluginTheme;onLink:(href:string,wiki?:boolean)=>void}){
  const frontmatter=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const [properties,setProperties]=useState(false);
  const fullBody=frontmatter?text.slice(frontmatter[0].length):text;
  const bodyText=fullBody.slice(0,120000);
  const tokens=useMemo(()=>marked.lexer(bodyText),[bodyText]);
  const body={color:theme.colors.foreground,fontSize:17,lineHeight:27};
  function inline(ts:Token[]|undefined,fallback=''):ReactNode {return ts?.map((token,i)=>{const t=token as Token & {text?:string;tokens?:Token[];href?:string};
    switch(t.type){case 'strong':return <Text key={i} style={{fontWeight:'700'}}>{inline(t.tokens,t.text)}</Text>;case 'em':return <Text key={i} style={{fontStyle:'italic'}}>{inline(t.tokens,t.text)}</Text>;case 'del':return <Text key={i} style={{textDecorationLine:'line-through'}}>{inline(t.tokens,t.text)}</Text>;case 'codespan':return <Text key={i} style={{fontFamily:mono,backgroundColor:theme.colors.surface2,fontSize:15}}>{t.text}</Text>;case 'br':return '\n';case 'link':case 'wikilink':return <Text key={i} accessibilityRole="link" onPress={()=>onLink(t.href??'',t.type==='wikilink')} style={{color:theme.colors.accent,textDecorationLine:'underline'}}>{inline(t.tokens,t.text)}</Text>;case 'image':return <Text key={i} onPress={()=>onLink(t.href??'')} style={{color:theme.colors.accent}}>▧ {t.text||'Image attachment'}</Text>;default:return t.tokens?inline(t.tokens,t.text):t.text??t.raw;}
  })??fallback;}
  function blocks(ts:Token[],depth=0):ReactNode{return ts.slice(0,2000).map((t,i)=>{if(depth>12)return <Text key={i} style={body}>{t.raw}</Text>;
    switch(t.type){case 'space':return null;case 'heading':{const h=t as Tokens.Heading;return <Text key={i} accessibilityRole="header" selectable style={{...body,fontSize:[30,26,23,20,18,17][h.depth-1],lineHeight:[38,34,31,28,26,25][h.depth-1],fontWeight:'700',marginTop:20,marginBottom:10}}>{inline(h.tokens,h.text)}</Text>;}
    case 'paragraph':case 'text':return <Text key={i} selectable style={{...body,marginBottom:13}}>{inline((t as Tokens.Paragraph).tokens,(t as Tokens.Paragraph).text)}</Text>;
    case 'code':{const code=t as Tokens.Code;return <View key={i} style={{backgroundColor:theme.colors.surface1,borderRadius:10,padding:14,marginVertical:10}}><Text style={{color:theme.colors.foregroundMuted,fontSize:12,marginBottom:8}}>{code.lang||'code'}</Text><ScrollView horizontal><Code text={code.text} language={code.lang??''} theme={theme}/></ScrollView></View>;}
    case 'blockquote':return <View key={i} style={{borderLeftWidth:3,borderLeftColor:theme.colors.accent,paddingLeft:14,marginVertical:10}}>{blocks((t as Tokens.Blockquote).tokens,depth+1)}</View>;
    case 'list':{const list=t as Tokens.List;return <View key={i} style={{marginVertical:6}}>{list.items.map((item,j)=><View key={j} style={{flexDirection:'row',gap:10,paddingBottom:4}}><Text style={body}>{item.task?(item.checked?'☑':'☐'):list.ordered?`${Number(list.start)+j}.`:'•'}</Text><View style={{flex:1}}>{blocks(item.tokens,depth+1)}</View></View>)}</View>;}
    case 'table':{const table=t as Tokens.Table;return <ScrollView horizontal key={i} style={{marginVertical:12}}><View>{[table.header,...table.rows].map((row,j)=><View key={j} style={{flexDirection:'row',borderBottomWidth:1,borderColor:theme.colors.border,backgroundColor:j===0?theme.colors.surface1:undefined}}>{row.map((cell,k)=><Text key={k} selectable style={{...body,width:180,padding:10,fontWeight:j===0?'600':'400'}}>{inline(cell.tokens,cell.text)}</Text>)}</View>)}</View></ScrollView>;}
    case 'hr':return <View key={i} style={{height:1,backgroundColor:theme.colors.border,marginVertical:18}}/>;
    default:return <Text key={i} selectable style={{...body,marginBottom:12}}>{t.raw}</Text>;
  }});}
  return <View style={{width:'100%',maxWidth:800,alignSelf:'center'}}>{frontmatter&&<View style={{marginVertical:12,padding:12,borderWidth:1,borderColor:theme.colors.border,borderRadius:8}}><Text accessibilityRole="button" onPress={()=>setProperties(!properties)} style={{color:theme.colors.foregroundMuted,paddingVertical:8}}>{properties?'▾':'▸'} Properties</Text>{properties&&<Code text={frontmatter[1]} language="yaml" theme={theme}/>}</View>}{blocks(tokens)}{fullBody.length>120000&&<Text style={{color:theme.colors.foregroundMuted,marginTop:20}}>Reading preview is limited to 120,000 characters. Edit mode contains the complete file.</Text>}</View>;
}
