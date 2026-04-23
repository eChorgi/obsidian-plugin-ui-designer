import {App, PluginSettingTab, Setting} from "obsidian";
import SelectorInstance from "./main";

export interface VisualUIEditorSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: VisualUIEditorSettings = {
	mySetting: 'default'
}

export class VisualUIEditorSettingTab extends PluginSettingTab {
	plugin: SelectorInstance;

	constructor(app: App, plugin: SelectorInstance) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
        .setName("快捷键设置")
        .setDesc("点击按钮前往全局设置页，为检查器配置快捷键")
        .addButton(btn => btn
            .setButtonText("前往配置")
            .onClick(() => {
                // 利用内置 Command ID 跳转
                // app.setting.openTabById('hotkeys') 打开快捷键面板
                // app.setting.activeTab.setQuery('你的插件名') 自动搜索
                const setting = this.app.setting;
                setting.open();
                const hotkeysTab = setting.openTabById('hotkeys');
                hotkeysTab.setQuery(this.plugin.manifest.name);
            })
        );
	}
}
