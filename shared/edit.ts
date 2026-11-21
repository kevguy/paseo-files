export type Selection = { start: number; end: number };
export type Edit = { text: string; selection: Selection };
export function wrap(text: string, selection: Selection, before: string, after = before): Edit {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  return {text: text.slice(0, start) + before + text.slice(start,end) + after + text.slice(end), selection:{start:start+before.length,end:end+before.length}};
}
export function prefixLines(text: string, selection: Selection, prefix: string): Edit {
  const start = selection.start===0?0:text.lastIndexOf('\n',selection.start-1)+1;
  const end = selection.end;
  const part = prefix+text.slice(start,end).replace(/\n/g,'\n'+prefix);
  return {text:text.slice(0,start)+part+text.slice(end),selection:{start:start+prefix.length,end:start+part.length}};
}
export function nextMatch(text: string, query: string, from: number): Selection | null {
  if (!query) return null;
  const source=text.toLowerCase(), needle=query.toLowerCase();
  let at=source.indexOf(needle,from); if(at<0)at=source.indexOf(needle);
  return at<0?null:{start:at,end:at+query.length};
}
export function linkPath(from: string, href: string): {path:string;anchor:string} | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href)||href.startsWith('//')||href.includes('\0'))return null;
  let decoded:string;try{decoded=decodeURIComponent(href);}catch{return null;}
  if(decoded.includes('\\'))return null;
  const [path,anchor='']=decoded.split('#');
  if(!path)return {path:from,anchor};
  const parts=path.startsWith('/')?[]:from.split('/').slice(0,-1);
  for(const part of path.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop();}else parts.push(part);}
  return {path:parts.join('/'),anchor};
}
export const TEXT_EXTENSIONS=['md','markdown','mdx','txt','log','json','jsonc','yaml','yml','toml','ini','cfg','conf','csv','tsv','js','jsx','mjs','cjs','ts','tsx','py','rb','go','rs','java','kt','kts','swift','c','h','cpp','hpp','cs','sh','bash','zsh','fish','sql','html','htm','css','scss','sass','less','xml','svg','vue','svelte','graphql','gql','tex','r','dart','ex','exs','erl','lua','php','pl','proto','properties','env','gitignore','dockerignore'];
