import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {build} from 'esbuild';

// Renders the real Editor on the web path (react-native-web, as Paseo's web and desktop apps run it)
// to static markup. The SDK modules the host provides are stubbed, as in tests/browser/run.ts.
const root=resolve(import.meta.dirname,'..');
type Render=(props:Record<string,unknown>)=>string;
let render:Promise<Render>|undefined;
function editor():Promise<Render>{
  render??=build({
    stdin:{contents:`import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Editor} from './client/editor';export const render=props=>renderToStaticMarkup(createElement(Editor,props));`,resolveDir:root,loader:'tsx'},
    bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',logLevel:'error',
    alias:{'react-native':'react-native-web'},
    define:{'process.env.NODE_ENV':'"production"'},
    // Node built-ins the bundled CommonJS code requires.
    banner:{js:`import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(root+'/')});`},
    plugins:[{name:'sdk-stub',setup(b){
      b.onResolve({filter:/^@getpaseo\/plugin\/client\/ui$/},()=>({path:'ui',namespace:'stub'}));
      b.onResolve({filter:/use-bottom-inset$/},()=>({path:'inset',namespace:'stub'}));
      b.onLoad({filter:/^ui$/,namespace:'stub'},()=>({contents:'export async function copyText(){} export function DocumentFrame(){return null;}',loader:'js'}));
      b.onLoad({filter:/^inset$/,namespace:'stub'},()=>({contents:`import {useRef} from 'react'; export function useBottomInset(){return {bottomInset:0,ref:useRef(null),onLayout(){}};}`,loader:'js',resolveDir:root}));
    }}],
  }).then(async result=>(await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)).render as Render);
  return render;
}

const colors={foreground:'#20232a',foregroundMuted:'#69717d',accent:'#6251d5',accentForeground:'#ffffff',surface0:'#ffffff',surface1:'#f3f4f7',surface2:'#e9eaf0',border:'#d9dce3',statusSuccess:'#26824c',statusDanger:'#b42318'};
const noop=()=>{};
async function open(path:string,text:string,extra:Record<string,unknown>={}){
  return (await editor())({...extra,draft:{path,text,baseText:text,revision:'r1'},theme:{id:'t',name:'t',colors},compact:false,busy:false,error:'',onChange:noop,onSave:noop,onReload:noop,onLink:noop,web:true,vimMode:false,onVimChange:noop,...extra});
}
const frames=(markup:string)=>[...markup.matchAll(/<iframe [^>]*>/g)].map(m=>m[0]);

test('HTML files open in a sandboxed Preview on the web, with Source beside it',async()=>{
  for(const path of ['site/index.html','legacy/PAGE.HTM']){
    const markup=await open(path,'<!doctype html><h1>Plot 14</h1><script>document.title="x"</script>');
    const [frame,...rest]=frames(markup);
    assert.ok(frame,path);assert.equal(rest.length,0);
    assert.match(frame,/sandbox="allow-scripts"/);
    assert.match(frame,/src="data:text\/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20http-equiv%3D%22Content-Security-Policy%22/);
    assert.match(frame,/no-referrer/);
    assert.match(markup,/>Preview</);assert.match(markup,/>Source</);
    assert.equal(markup.includes('>Syntax<'),false);
  }
});

test('Markdown and other files keep their views and get no frame',async()=>{
  const md=await open('notes/plan.md','# Plan\n\nSome text.');
  assert.equal(frames(md).length,0);assert.match(md,/>Read</);assert.equal(md.includes('>Source<'),false);assert.equal(md.includes('>Preview<'),false);
  const css=await open('site/style.css','body{color:red}');
  assert.equal(frames(css).length,0);assert.match(css,/>Syntax</);assert.equal(css.includes('>Source<'),false);
});

test('a draft with a lone surrogate or past the URL limit renders without throwing',async()=>{
  const lone=frames(await open('a.html','<p>broken \uD83C pair</p>'));
  assert.equal(lone.length,1);assert.match(lone[0],/%EF%BF%BD/);
  const big=await open('big.html','<'.repeat(800_000));
  assert.equal(frames(big).length,0);
  assert.match(big,/Too large to preview here; use Source/);
});

test('an HTML search hit with a line number opens in Edit, with no frame',async()=>{
  const markup=await open('site/index.html','<!doctype html>\n<h1>Plot 14</h1>\n<p>Beds</p>',{initialLine:3});
  assert.equal(frames(markup).length,0);
  assert.match(markup,/>Preview</);assert.match(markup,/>Source</);
});
