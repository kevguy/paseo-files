import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wrap,prefixLines,nextMatch,linkPath} from '../shared/edit';
test('format selected text and keep selection inside inserted markers',()=>{assert.deepEqual(wrap('hello world',{start:6,end:11},'**'),{text:'hello **world**',selection:{start:8,end:13}});});
test('line prefixes preserve CRLF and include whole first selected line',()=>{assert.equal(prefixLines('one\r\ntwo',{start:0,end:8},'- ').text,'- one\r\n- two');assert.equal(prefixLines('\ntext',{start:0,end:0},'# ').text,'# \ntext');});
test('literal find wraps without regex interpretation',()=>{assert.deepEqual(nextMatch('a+b A+B','a+b',4),{start:4,end:7});assert.deepEqual(nextMatch('a+b A+B','a+b',7),{start:0,end:3});assert.equal(nextMatch('abc','[',0),null);});
test('relative note links stay inside workspace and reject executable schemes',()=>{assert.deepEqual(linkPath('notes/a.md','../b.md#heading'),{path:'b.md',anchor:'heading'});assert.equal(linkPath('a.md','../../outside'),null);assert.equal(linkPath('a.md','javascript:alert(1)'),null);assert.equal(linkPath('a.md','file:///etc/passwd'),null);assert.equal(linkPath('a.md','//other/file'),null);assert.equal(linkPath('a.md','%ZZ'),null);assert.deepEqual(linkPath('notes/a.md','#Heading'),{path:'notes/a.md',anchor:'Heading'});});
