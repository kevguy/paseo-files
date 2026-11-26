import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HTML_PREVIEW_MAX_URL_LENGTH,HTML_PREVIEW_POLICY,HTML_PREVIEW_PROLOGUE,htmlPreviewSource,htmlPreviewUrl,isHtmlPreviewPath,wellFormed,withPreviewCsp} from '../shared/html-preview';
import {HtmlFrame} from '../client/html-frame';
import {TEXT_EXTENSIONS} from '../shared/edit';

const POLICY="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
const PREFIX='data:text/html;charset=utf-8,';

test('the policy matches Paseo\'s HTML preview exactly',()=>{
  assert.equal(HTML_PREVIEW_POLICY,POLICY);
  assert.equal(HTML_PREVIEW_PROLOGUE,`<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}">`);
});

test('the policy comes before the whole file, which is kept verbatim',()=>{
  const source=' <!-- untrusted --!><!doctype html "\'><script>location=\'https://example.com\'</script>';
  const output=withPreviewCsp(source);
  assert.ok(output.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
  assert.ok(output.endsWith(source));
  assert.equal(output.length,HTML_PREVIEW_PROLOGUE.length+source.length);
  assert.ok(output.indexOf('Content-Security-Policy')<output.indexOf('<script>'));
});

test('a leading byte order mark is dropped, and only a leading one',()=>{
  assert.equal(withPreviewCsp('\uFEFF<h1>Plan</h1>'),HTML_PREVIEW_PROLOGUE+'<h1>Plan</h1>');
  assert.equal(withPreviewCsp('<p>a\uFEFFb</p>'),HTML_PREVIEW_PROLOGUE+'<p>a\uFEFFb</p>');
  assert.equal(withPreviewCsp(''),HTML_PREVIEW_PROLOGUE);
});

test('the data URL percent-encodes the prologue and the file and decodes back to them',()=>{
  const html='<h1 class="t">Plan #1 & 100% done</h1>\n<p>Café 🌱</p><a href="#top">top</a>';
  const url=htmlPreviewUrl(html);
  assert.ok(url.startsWith(PREFIX));
  const body=url.slice(PREFIX.length);
  assert.equal(body,encodeURIComponent(HTML_PREVIEW_PROLOGUE+html));
  // '#' would end the document at a fragment; none of the markup characters may stay raw.
  assert.doesNotMatch(body,/[#&<>" \n]/);
  assert.equal(decodeURIComponent(body),withPreviewCsp(html));
  assert.equal(decodeURIComponent(htmlPreviewUrl('\uFEFF<p>x</p>').slice(PREFIX.length)),HTML_PREVIEW_PROLOGUE+'<p>x</p>');
});

test('only .html and .htm files get a rendered preview',()=>{
  for(const path of ['index.html','site/INDEX.HTM','a/b.c/page.htm','notes/plan.Html'])assert.equal(isHtmlPreviewPath(path),true,path);
  for(const path of ['README.md','notes.markdown','page.xhtml','style.css','image.svg','data.xml','html','.html','html/readme.txt','page.html.bak'])assert.equal(isHtmlPreviewPath(path),false,path);
  assert.deepEqual(TEXT_EXTENSIONS.filter(ext=>isHtmlPreviewPath(`file.${ext}`)),['html','htm']);
});

test('the web frame is sandboxed to scripts only, sends no referrer and loads the data URL',()=>{
  const html='<!doctype html><script>document.title="x"</script><p>Hi</p>';
  const markup=renderToStaticMarkup(createElement(HtmlFrame,{html,fallback:()=>'unavailable'}));
  const attrs=Object.fromEntries([...markup.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  assert.match(markup,/^<iframe /);
  assert.equal(attrs.sandbox,'allow-scripts');
  assert.equal(attrs.referrerPolicy??attrs.referrerpolicy,'no-referrer');
  assert.equal(attrs.src.replace(/&#x27;/g,"'").replace(/&amp;/g,'&'),htmlPreviewUrl(html));
  assert.equal(attrs.title,'HTML preview');
  for(const forbidden of ['allow-same-origin','allow-popups','allow-top-navigation','srcdoc','allow='])assert.equal(markup.includes(forbidden),false,forbidden);
});

test('lone surrogates in a draft become U+FFFD instead of throwing',()=>{
  const lone='<p>high \uD83C end, low \uDF31 start, pair \uD83C\uDF31</p>';
  assert.throws(()=>encodeURIComponent(lone),URIError);
  assert.equal(wellFormed(lone),'<p>high \uFFFD end, low \uFFFD start, pair \uD83C\uDF31</p>');
  assert.equal(wellFormed('\uDC00\uD800'),'\uFFFD\uFFFD');
  assert.equal(wellFormed('plain'),'plain');
  const url=htmlPreviewUrl(lone);
  assert.equal(decodeURIComponent(url.slice(PREFIX.length)),HTML_PREVIEW_PROLOGUE+wellFormed(lone));
});

test('the fallback without String.prototype.toWellFormed gives the same result',()=>{
  const proto=String.prototype as unknown as {toWellFormed?:unknown};
  const saved=Object.getOwnPropertyDescriptor(String.prototype,'toWellFormed');
  if(saved)delete proto.toWellFormed;
  try{
    assert.equal(typeof proto.toWellFormed,'undefined');
    assert.equal(wellFormed('a\uD800b\uDFFFc\uD83C\uDF31'),'a\uFFFDb\uFFFDc\uD83C\uDF31');
  }finally{if(saved)Object.defineProperty(String.prototype,'toWellFormed',saved);}
});

test('a frame URL over 2 MiB is refused and the frame shows the fallback instead',()=>{
  assert.equal(HTML_PREVIEW_MAX_URL_LENGTH,2*1024*1024);
  // A saved file is at most 512 KiB; even every byte escaped (%XX) stays under the limit.
  assert.ok(htmlPreviewSource('\u00e9'.repeat(256*1024))!==null);
  const big='<'.repeat(Math.ceil(HTML_PREVIEW_MAX_URL_LENGTH/3));
  assert.equal(htmlPreviewSource(big),null);
  const markup=renderToStaticMarkup(createElement(HtmlFrame,{html:big,fallback:problem=>`unavailable:${problem}`}));
  assert.equal(markup.includes('<iframe'),false);
  assert.match(markup,/unavailable:too-large/);
});
