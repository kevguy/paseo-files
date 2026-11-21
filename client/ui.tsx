import type { PluginTheme } from '@getpaseo/plugin';
import {Children,type ReactNode} from 'react';
import {Pressable,Text,View} from 'react-native';
export function Button({children,onPress,theme,selected=false,disabled=false,label}: {children:ReactNode;onPress:()=>void;theme:PluginTheme;selected?:boolean;disabled?:boolean;label?:string}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label??(typeof children==='string'?children:undefined)} accessibilityState={{disabled,selected}} disabled={disabled} onPress={onPress} style={({pressed})=>({minHeight:44,paddingHorizontal:13,paddingVertical:10,borderRadius:9,backgroundColor:selected?theme.colors.accent:theme.colors.surface1,borderWidth:1,borderColor:selected?theme.colors.accent:theme.colors.border,opacity:disabled?.4:pressed?.7:1,justifyContent:'center'})}><Text style={{color:selected?theme.colors.accentForeground:theme.colors.foreground,fontSize:14,fontWeight:selected?'600':'400'}}>{children}</Text></Pressable>;
}
export function Notice({children,theme,danger=false}: {children:ReactNode;theme:PluginTheme;danger?:boolean}){return <View style={{padding:12,borderWidth:1,borderColor:danger?theme.colors.statusDanger:theme.colors.border,borderRadius:9,marginVertical:6}}>{Children.map(children,child=>typeof child==='string'||typeof child==='number'?<Text selectable style={{color:danger?theme.colors.statusDanger:theme.colors.foregroundMuted,lineHeight:21}}>{child}</Text>:child)}</View>;}
export const mono = 'monospace';
