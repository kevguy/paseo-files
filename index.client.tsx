import type {PluginClientContext,PluginSidebarItemProps} from '@getpaseo/plugin/client';
import {SidebarRow} from '@getpaseo/plugin/client/ui';
import {createFilesScreen,FilesPanel,FileEditorPanel} from './client/files';
import {TEXT_EXTENSIONS} from './shared/edit';
import {setHostClient} from './client/doc-viewer/host-client';
import {DocumentScreen} from './client/doc-viewer/document-screen';
import {FilePanelReader} from './client/doc-viewer/file-panel-reader';
import {addFilePanel} from './client/doc-viewer/file-panel';
import {ViewerSettings} from './client/doc-viewer/settings-screen';
import {ReviewScreen} from './client/doc-viewer/review-screen';
import {DOCUMENT_SCREEN_ID,SETTINGS_SCREEN_ID} from './client/doc-viewer/recent';
import {REVIEW_SCREEN_ID} from './client/doc-viewer/review-note';
function FilesItem({currentScreen,openScreen}:PluginSidebarItemProps){return <SidebarRow icon="FolderOpen" active={currentScreen?.screenId==='files-home'} onPress={()=>openScreen({screenId:'files-home'})}/>;}
export default function contribute(client:PluginClientContext){setHostClient(client);const cleanups=[
 client.addScreen({id:'files-home',title:'Files & Notes',Component:createFilesScreen(client)}),
 client.addSidebarHeaderItem({id:'files',title:'Files & Notes',Component:FilesItem}),
 client.addWorkspacePanel({id:'files',title:'Files & Notes',icon:'FolderOpen',locations:['workspace','explorer'],Component:FilesPanel}),
 client.addCommandCenterItem({id:'files',title:'Find files and notes',icon:'Search',keywords:['markdown','edit','search','files','directory','pdf'],context:'workspace',onSelect:({workspace})=>client.openPanel('files',{workspaceId:workspace.id})}),
 client.addFilePanel({id:'editor',title:'Notes & Code',icon:'FilePen',files:{extensions:TEXT_EXTENSIONS,filenames:['Dockerfile','Makefile','LICENSE','README','.gitignore','.env.example']},Component:FileEditorPanel}),
 client.addScreen({id:DOCUMENT_SCREEN_ID,title:'Document',Component:DocumentScreen}),
 client.addScreen({id:REVIEW_SCREEN_ID,title:'Review notes',Component:ReviewScreen}),
 client.addSettingsScreen({id:SETTINGS_SCREEN_ID,title:'Document viewer',icon:'FileText',Component:ViewerSettings}),
 addFilePanel(client,FilePanelReader)
];return()=>{setHostClient(null);cleanups.forEach(fn=>fn());};}
