// types.ts
export type SettingType = 
  | 'slider' 
  | 'color' 
  | 'font' 
  | 'text' 
  | 'select' 
  | 'image-upload'
  | 'none'
  | null
  | undefined;

export type RoleType = 
  | 'shorthand' 
  | 'part-1' 
  | 'part-2' 
  | 'part-3' 
  | 'part-4' 
  | 'part'
  | 'functionalNotion'
  | undefined;

export interface UISetting {
  name: string;
  prop: string;
  type: SettingType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[] | undefined;
  optionsDisplay?: string[] | undefined;
  default?: string; // 可以使用更具体的类型，比如 string | number | boolean
  subs?: UISetting[];
  on?: string;
  also?: string;
  role?: RoleType;
}
declare module "obsidian" {
    interface App {
        customCss: {
            readSnippets: () => Promise<void>;
            enabledSnippets: Set<string>;
            setCssEnabledStatus: (snippetName: string, enabled: boolean) => Promise<void>;
        };
        setting: {
            open: () => void;
            openTabById: (id: string) => SettingTab;
            activeTab: SettingTab;
        };
    }
    interface SettingTab {
        setQuery: (query: string) => void;
    }
}
declare module "obsidian" {
    interface Plugin {
        /** 动态添加 CSS 样式，插件卸载时会自动移除 */
        addStyle(css: string): HTMLStyleElement;
    }
}