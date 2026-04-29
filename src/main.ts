import { App, Plugin, Notice, Setting, ColorComponent, Modal } from 'obsidian';
import { UISetting } from './types';

export default class VisualUIEditorPlugin extends Plugin {

    public addStyle (css: string): HTMLStyleElement {
        return this.addStyle(css);
    }
    onload() {
        this.addRibbonIcon('target', '选择UI元素进行修改', () => {
            new MultiSelectorInstance(this.app, this);
        });

        this.addCommand({
            id: 'start-multi-element-selector',
            name: '选择UI元素进行修改',
            callback: () => new MultiSelectorInstance(this.app, this)
        });
    }
}

export class ConfirmModal extends Modal {
    private isConfirmed = false;
    private resolvePromise!: (value: boolean) => void;

    constructor(app: App, private message: string) {
        super(app);
        // 添加命名空间和 macOS 风格类名
        this.modalEl.addClass('visual-ui-editor');
        this.modalEl.addClass('confirm-modal-mac');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty(); // 清空默认边距干扰

        // 1. 创建标题文本
        contentEl.createEl('h2', { text: this.message });

        // 2. 创建按钮容器
        const buttonContainer = contentEl.createDiv({ cls: 'confirm-modal-buttons' });
        
        // 3. 确认按钮 (macOS 习惯：确认在右)
        const confirmButton = buttonContainer.createEl('button', { 
            text: '确认', 
            cls: 'confirm-button-mac' 
        });
        
        // 4. 取消按钮
        const cancelButton = buttonContainer.createEl('button', { 
            text: '取消', 
            cls: 'cancel-button-mac' 
        });

        //删除默认关闭按钮
        this.modalEl.querySelector('.modal-close-button')?.remove();
        

        // --- 事件绑定 ---

        confirmButton.addEventListener('click', () => {
            this.isConfirmed = true;
            this.close();
        });

        cancelButton.addEventListener('click', () => {
            this.close();
        });

        // 5. 辅助功能：自动聚焦确认按钮 & 支持回车键
        confirmButton.focus();
        this.scope.register([], 'Enter', (evt: KeyboardEvent) => {
            if (!evt.isComposing) {
                this.isConfirmed = true;
                this.close();
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        
        // 只有在弹窗彻底关闭时，才 resolve Promise
        // 确保无论是点击按钮关闭，还是点击背景/按 ESC 关闭，都能有返回值
        if (this.resolvePromise) {
            this.resolvePromise(this.isConfirmed);
        }
    }

    /**
     * 静态封装函数：像原生 confirm 一样异步调用
     * @example const result = await ConfirmModal.confirm(app, "确定删除吗？");
     */
    public static confirm(app: App, message: string): Promise<boolean> {
        return new Promise((resolve) => {
            const modal = new ConfirmModal(app, message);
            modal.resolvePromise = resolve; // 将 resolve 传递给实例
            modal.open();
        });
    }
}

class AttributeEditItem {
    constructor(
        public name: string,
        public prop: string,
        public type: 'slider' | 'color' | 'font' | 'text' | 'select' | 'image-upload'| 'none' | null | undefined,
        public options: { min?: number; max?: number; step?: number; unit?: string; options?: string[]; optionsDisplay?: string[] ,default?: string} | undefined,
        private subs: UISetting[] = [],
        public on: string | undefined = undefined,
        public also: string[] | undefined = undefined, // 关联属性（如 color 关联 -webkit-text-fill-color）
        public role: string | undefined = undefined, // 角色（如 'shorthand', 'part-x') 用于拼接属性值
        public previewEl: HTMLElement,
        public body: HTMLElement,
        public computedStyle: CSSStyleDeclaration
    ) {
        this.subItems = []
        subs.forEach(sub => {
            this.subItems.push(new AttributeEditItem(
                sub.name,
                sub.prop,
                sub.type,
                { min: sub?.min, max: sub?.max, step: sub?.step, unit: sub?.unit, options: sub?.options, optionsDisplay: sub?.optionsDisplay ,default: sub?.default},
                sub.subs,
                sub.on,
                sub.also,
                sub.role,
                this.previewEl,
                this.body,
                this.computedStyle
            ));

        });
    }
    public subItems: AttributeEditItem[] = [];
    public setting!: Setting;
    public valueDisplay!: HTMLElement;
    public controlEl!: HTMLElement;
    public orginValue!: string;
    public currentValue!: string|undefined;
    public parentItem?: AttributeEditItem;
    public subContainer!: HTMLDivElement; // 用于存放子属性的容器
    public inputEl!: HTMLInputElement; // 仅 text 类型使用
    private onUpdate: (() => void) | null = null; // 用于监听属性更新的回调函数
    private onReset: (() => void) | null = null; // 用于监听重置的回调函数

    //导出css
    public exportCSS(isImportant: boolean = false): string {    
        let css = `${this.prop}: ${this.currentValue}${isImportant ? ' !important' : ''};\n`;
        if(this.also) {
            this.also.forEach(alsoProp => {
                css += `${alsoProp}: ${this.currentValue}${isImportant ? ' !important' : ''};\n`;
            });
        }
        if(this.currentValue === undefined || this.currentValue == this.orginValue || this.role?.startsWith('part')) css = '';
        this.subItems.forEach(sub => {
            css += sub.exportCSS(isImportant);
        });
        return css;
    }

    private rgbToRgba(rgb: string, alpha: number): string {
        const result = rgb.match(/\d+/g);
        if (!result || result.length < 3) {
            return `rgba(255, 255, 255, ${alpha})`; // 默认白色
        }
        const r = parseInt(result[0]);
        //@ts-ignore
        const g = parseInt(result[1]);
        //@ts-ignore
        const b = parseInt(result[2]);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    private rgbToHex(rgb: string): string {
        if(!rgb.startsWith("rgb")) {
            if(rgb.startsWith("#") && (rgb.length === 7 || rgb.length === 9)) {
                return rgb.slice(0, 7); // 如果不是 rgb 格式，直接返回原值
            }
            return rgb;
        }
        // 匹配数字，如果没有匹配到，result 将会是 null
        const result = rgb.match(/\d+/g);
        
        // 如果 result 为空，或者匹配到的数字少于 3 个，直接返回默认颜色
        if (!result || result.length < 3) {
            return '#ffffff'; 
        }
        
        const r = parseInt(result[0]);
        //@ts-ignore
        const g = parseInt(result[1]);
        //@ts-ignore
        const b = parseInt(result[2]);
        
        // 使用位运算转换为 Hex
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    private stringToRgba(color: string): string {
        if(color.startsWith("rgb(")) {
            return this.rgbToRgba(color, 1); // 转换为 rgba 格式并默认添加不透明度
        }
        else if(color.startsWith("#")) {
            return this.hexToRgba(color); // 转换为 rgba 格式并默认添加不透明度
        }
        return color; // 其他格式直接返回
    }

    private hexToRgba(hex: string): string {
        const result = hex.match(/\w\w/g);
        if (!result || (result.length !== 3 && result.length !== 4)) {
            return `rgba(255, 255, 255, 1)`; // 默认白色
        }
        const r = parseInt(result[0], 16);
        //@ts-ignore
        const g = parseInt(result[1], 16);
        //@ts-ignore
        const b = parseInt(result[2], 16);
        //@ts-ignore
        const a = result.length === 4 ? parseInt(result[3], 16) / 255 : 1;
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    private stringToHex(color: string): string {
        if(color.startsWith("rgba(")) {
            return this.rgbaToHex(color); // 转换为 hex 格式
        }
        else if(color.startsWith("rgb(")) {
            return this.rgbToHex(color); // 转换为 hex 格式
        }
        return color; // 其他格式直接返回
    }

    private rgbaToHex(rgba: string): string {
        if(!rgba.startsWith("rgba(")) {
            return rgba; // 如果不是 rgba 格式，直接返回原值
        }
        const result = rgba.match(/[\d.]+/g);
        if (!result || result.length < 4) {
            return '#ffffff00'; // 默认透明颜色
        }
        const r = parseInt(result[0]);
        //@ts-ignore
        const g = parseInt(result[1]);
        //@ts-ignore
        const b = parseInt(result[2]);
        //@ts-ignore
        const a = Math.round(parseFloat(result[3] * 255));
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1) + a.toString(16).padStart(2, '0');
    }

    private async loadSystemFonts(selectEl: HTMLSelectElement) {
        // @ts-ignore - 忽略 window 类型错误
        if (!('queryLocalFonts' in window)) {
            throw new Error('API not supported');
        }
        interface FontData {
            family: string;
            fullName: string;
            postscriptName: string;
            style: string;
        }

        try {
            //@ts-ignore
            const fonts = await window.queryLocalFonts() as FontData[];
            // @ts-ignore
            const fontNames = [...new Set(fonts.map(f => f.family))].sort(); // 去重排序

            fontNames.forEach(name => {
                const option = selectEl.createEl('option');
            // @ts-ignore
                option.value = name;
            // @ts-ignore
                option.textContent = name;
            // @ts-ignore
                option.style.fontFamily = name; // 让下拉项显示对应字体
            });
        } catch (err) {
            console.error('获取系统字体失败:', err);
            throw err;
        }
    }

    // 回退方案：通用 Web 字体列表
    private loadFallbackFonts(selectEl: HTMLSelectElement) {
        const commonFonts = [
            'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 
            'Courier New', 'Verdana', 'system-ui', 'monospace'
        ];

        commonFonts.forEach(font => {
            const option = selectEl.createEl('option');
            option.value = font;
            option.textContent = font;
        });
    }


    private applyShorthandValue(): string {
        if (this.role === 'shorthand') {
            const partMap: Map<number, string> = new Map();
            let num = 0;
            let count = 0;
            this.subItems.forEach(sub => {
                if (sub.role?.startsWith('part-')) {
                    const index = parseInt(sub.role.split('-')[1] ?? '-1');
                    if(index == -1)
                        throw new Error(`Invalid shorthand part role: ${sub.role}`);
                    
                    num++;
                    let value = sub.currentValue;
                    if(value === undefined) {
                        if(sub.options?.default === undefined) {
                            throw new Error(`Missing value for ${sub.name} and no default provided.`);
                        }
                        value = sub.options?.default;
                        count++;
                    }

                    partMap.set(index, value);
                }
            });
            const array = Array.from(partMap.entries()).sort((a, b) => a[0] - b[0]) // 按照索引排序
            let finalValue = ''
            array.forEach(([_, value]) => {
                finalValue += value + ' ';
            });
            if(count === num) {
                finalValue = this.orginValue;
            }
                this.setProp(finalValue.trim());
            if (this.type==='text') {
                // this.valueDisplay.textContent = finalValue.trim();
                this.inputEl.value = finalValue.trim();
            }
            return finalValue.trim();
        }
        else if (this.role === 'functionalNotion') {
            const parts: string[] = [];
            this.subItems.forEach(sub => {
                if (sub.role==='part') {

                    if(sub.currentValue !== undefined) {
                        let value = `${sub.prop}(${sub.currentValue})`;
                        parts.push(value);
                    }
                }
            });
            let finalValue = ''
            parts.forEach(value => {
                finalValue += value + ' ';
            });
            if(finalValue.trim() === '') {
                finalValue = this.orginValue;
            }
            this.setProp(finalValue.trim());
            if (this.type==='text') {
                // this.valueDisplay.textContent = finalValue.trim();
                this.inputEl.value = finalValue.trim();
            }
            return finalValue.trim();
        }
        
        return '';
    }

    private setProp(value: string) {
        this.currentValue = value;
        if(this.currentValue === this.orginValue) {
            this.currentValue = undefined; // 如果值与原始值相同，则视为未修改
        }
        if (this.role?.startsWith('part')) {
            this.parentItem?.applyShorthandValue(); // 更新父属性的值
        }
        this.previewEl.style.setProperty(this.prop, value, 'important');
        if (this.also) {
            this.also.forEach(alsoProp => {
                this.previewEl.style.setProperty(alsoProp, value, 'important');
            });
        }
        if(this.onUpdate) {
            this.onUpdate();
        }
    }

    public reset() {
        if(this.subItems.length > 0) {
            // 递归重置子属性
            this.subItems.forEach(item => {
                item.reset();
            });
        }
        // if(this.name === "颜色")
        //     debugger
        // console.log(`Resetting ${this.name} to original value: ${this.orginValue}`);
        this.onReset?.();
        this.setProp(this.orginValue);
        this.currentValue = undefined;
    }
    public addListenerOnUpdate(callback: () => void) {
        this.onUpdate = callback;
        this.subItems.forEach(subItem => {
            subItem.addListenerOnUpdate(this.onUpdate!);
        });
    }

    public rebind(style: CSSStyleDeclaration, newPreviewEl: HTMLElement) {
        if(this.subItems.length > 0) {
            // 递归重置子属性
            this.subItems.forEach(item => {
                item.rebind(style, newPreviewEl);
            });
        }
        this.previewEl = newPreviewEl;
        this.computedStyle = style;
        this.orginValue = this.computedStyle.getPropertyValue(this.prop).trim();
        // console.log(`Rebinding ${this.name}: new origin value is ${this.orginValue}`);
        this.reset();
    }

    public createElement() {
        this.setting = new Setting(this.body).setName(this.name);
        this.orginValue = this.computedStyle.getPropertyValue(this.prop).trim();
        this.orginValue = this.stringToRgba(this.orginValue);

        if(this.orginValue === '') {
            this.orginValue = this.options?.default ?? '';
        }
        if (this.type === 'slider') {
            const numericValue = parseFloat(this.orginValue) || 0;
            const unit = this.options?.unit ?? '';

            // 1. 创建 UI 结构
            const displayStack = this.setting.controlEl.createDiv({ cls: 'value-display-stack' });
            const valueDisplay = displayStack.createEl('span', { text: `${numericValue}${unit}`, cls: 'value-display-label' });
            const valueInput = displayStack.createEl('input', { type: 'number', cls: 'value-display-input' });
            
            // 初始样式设置
            Object.assign(displayStack.style, { display: 'flex', alignItems: 'center', justifyContent: 'end', width: '70px', height: '16px' });
            Object.assign(valueDisplay.style, { cursor: 'pointer', fontSize: 'var(--font-smaller)', color: 'var(--text-muted)', borderBottom: '1px dashed var(--text-faint)'});
            Object.assign(valueInput.style, { display: 'none', border: 'none', maxWidth: '50px', textAlign: 'right', fontSize: 'var(--font-smaller)' });

            const slider = this.setting.controlEl.createEl('input', {
                type: 'range',
                attr: { min: String(this.options?.min ?? 0), max: String(this.options?.max ?? 100), step: String(this.options?.step ?? 1), value: String(numericValue) }
            });

            const updateAll = (val: number) => {
                const finalValue = `${val}${unit}`;
                valueDisplay.textContent = finalValue;
                valueInput.value = String(val);
                slider.value = String(val);
                this.setProp(finalValue); // 执行实际的 CSS 应用逻辑
            };

            this.onReset = () => {
                updateAll(numericValue);
            }

            // 2. 绑定点击切换逻辑 (仅负责显示隐藏)
            valueDisplay.addEventListener('click', () => {
                valueDisplay.classList.remove('visual-ui-editor-visible');
                valueDisplay.classList.add('visual-ui-editor-hidden');
                valueInput.classList.remove('visual-ui-editor-hidden');
                valueInput.classList.add('visual-ui-editor-visible');
                valueInput.focus();
            });
            

            // 3. 绑定输入框确认逻辑 (只绑定一次，不要写在 click 里面)
            const handleConfirm = () => {
                const newValue = parseFloat(valueInput.value);
                if (!isNaN(newValue)) {
                    updateAll(newValue);
                }
                valueInput.classList.remove('visual-ui-editor-visible');
                valueInput.classList.add('visual-ui-editor-hidden');
                valueDisplay.classList.remove('visual-ui-editor-hidden');
                valueDisplay.classList.add('visual-ui-editor-visible');
            };

            valueInput.addEventListener('blur', handleConfirm);
            valueInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') {
                    valueInput.classList.remove('visual-ui-editor-visible');
                    valueInput.classList.add('visual-ui-editor-hidden');
                    valueDisplay.classList.remove('visual-ui-editor-hidden');
                    valueDisplay.classList.add('visual-ui-editor-visible');
                }
            });

            // 4. 绑定 Slider 滑动逻辑
            slider.addEventListener('input', () => {
                updateAll(parseFloat(slider.value));
            });

            // 5. 重置按钮
            this.setting.addExtraButton(btn => btn
                .setIcon('reset')
                .onClick(() => {
                    this.reset();
                })
            );
        }
        else if (this.type === 'color') {
            // 1. 定义一个变量来存储组件实例
            let colorComponent: ColorComponent; 
            let sliderComponent: HTMLInputElement;

            // 1. 创建 UI 结构
            const displayStack = this.setting.controlEl.createDiv({ cls: 'value-display-stack' });
            const valueDisplay = displayStack.createEl('span', { text: `${this.orginValue}`, cls: 'value-display-label' });
            const valueInput = displayStack.createEl('input', { type: 'text', cls: 'value-display-input' });
            
            // 初始样式设置
            Object.assign(displayStack.style, { display: 'flex', alignItems: 'center', justifyContent: 'end', width: '70px', height: '16px' });
            Object.assign(valueDisplay.style, { cursor: 'pointer', fontSize: 'var(--font-smaller)', color: 'var(--text-muted)', borderBottom: '1px dashed var(--text-faint)'});
            Object.assign(valueInput.style, { display: 'none', border: 'none', maxWidth: '90px', textAlign: 'right', fontSize: 'var(--font-smaller)' });

            
            this.setting.addColorPicker(color => {
                colorComponent = color; // 将实例赋值给变量
                color
                    .setValue(this.stringToHex(this.orginValue))
                    .onChange((value) => {
                        let hex = value;
                        if(sliderComponent) {
                            const alpha = Math.round(parseFloat(sliderComponent.value) * 255).toString(16).padStart(2, '0');
                            hex += alpha;
                        }
                        updateAll(hex, 'colorPicker');
                    });
            });

            sliderComponent = this.setting.controlEl.createEl('input', {
                type: 'range',
                attr: { min: '0', max: '1', step: '0.01', value: '1' }
            });
            sliderComponent.addEventListener('input', () => {
                let hex = colorComponent.getValue();
                const alpha = Math.round(parseFloat(sliderComponent.value) * 255).toString(16).padStart(2, '0');
                hex += alpha;
                updateAll(hex, 'slider');
            });

            //添加一个显示当前颜色值的可编辑文本
            

            const updateAll = (color: string, sourse: 'colorPicker' | 'slider' | 'text' | 'none') => {
                const hexColor = this.stringToHex(color);
                const rgbaColor = this.stringToRgba(color);
                const alpha = hexColor.length === 9 ? parseInt(hexColor.slice(7, 9), 16) / 255 : 1;
                valueDisplay.textContent = hexColor;
                if(sourse !== 'text'){
                    valueInput.value = hexColor;
                }
                if (sourse !== 'slider' && sliderComponent) {
                    sliderComponent.value = String(alpha);
                }
                if (sourse !== 'colorPicker' && colorComponent != undefined) {
                    colorComponent.setValue(hexColor.slice(0, 7));
                }
                this.setProp(rgbaColor); // 执行实际的 CSS 应用逻辑
            };
            this.onReset = () => {
                updateAll(this.orginValue, 'none');
            };
            valueDisplay.addEventListener('click', () => {
                valueDisplay.classList.remove('visual-ui-editor-visible');
                valueDisplay.classList.add('visual-ui-editor-hidden');
                valueInput.classList.remove('visual-ui-editor-hidden');
                valueInput.classList.add('visual-ui-editor-visible');
                valueInput.value = `${colorComponent.getValue()}${Math.round(parseFloat(sliderComponent.value) * 255).toString(16).padStart(2, '0')}`;
                valueInput.focus();
            });

            // 3. 绑定输入框确认逻辑 (只绑定一次，不要写在 click 里面)
            const handleConfirm = () => {
                let val = valueInput.value;
                //末尾补齐0到8位
                if(val.startsWith("#")) {
                    val = String(valueInput.value).replace(/[^0-9a-fA-F]/g, '')
                    val = '#'+ val.padEnd(8, '0');
                }

                updateAll(val, 'text');
                valueInput.classList.remove('visual-ui-editor-visible');
                valueInput.classList.add('visual-ui-editor-hidden');
                valueDisplay.classList.remove('visual-ui-editor-hidden');
                valueDisplay.classList.add('visual-ui-editor-visible');
            };

            valueInput.addEventListener('blur', handleConfirm);
            valueInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') {
                    valueInput.classList.remove('visual-ui-editor-visible');
                    valueInput.classList.add('visual-ui-editor-hidden');
                    valueDisplay.classList.remove('visual-ui-editor-hidden');
                    valueDisplay.classList.add('visual-ui-editor-visible');
                }
            });

            // 清空按钮
            this.setting.addExtraButton(btn => btn
                .setIcon('cross')
                .setTooltip('清空')
                .onClick(() => {
                    updateAll('rgba(0, 0, 0, 0)', 'none');
                })
            );
            this.setting.addExtraButton(btn => btn
                .setIcon('reset')
                .setTooltip('重置')
                .onClick(() => {
                    // 应用原始样式
                    this.reset();
                    // new Notice(`已重置 ${this.name}`);
                })
            );
            updateAll(this.orginValue, 'none'); // 初始化显示
        }
        else if (this.type === 'font') {
            //显示提示文本
            // setting.setDesc('选择字体');

            const selectEl = this.setting.controlEl.createEl('select');
            
            // 1. 添加默认选项
            const defaultOption = selectEl.createEl('option');
            defaultOption.value = '';
            defaultOption.textContent = '查看系统字体';

            Object.assign(selectEl.style, {
                padding: '4px',
                minWidth: '120px'
            });

            // 2. 尝试获取系统字体
            this.loadSystemFonts(selectEl).catch(() => {
                // 如果获取失败，回退到通用字体列表
                this.loadFallbackFonts(selectEl);
            });

            // 3. 事件监听
            selectEl.addEventListener('change', () => {
                const fontFamily = selectEl.value;
                this.setProp(`"${fontFamily}"`);
                // 这里可以保存配置
            });

            this.onReset = () => {
                selectEl.value = '';
            }
            //添加重置按钮
            this.setting.addExtraButton(btn => btn
                .setIcon('reset')
                .onClick(() => {
                    this.reset();
                })
            );

        }
        else if (this.type === 'select') {
            const selectEl = this.setting.controlEl.createEl('select');
            this.options?.options?.forEach((opt, idx) => {
                const option = selectEl.createEl('option');
                option.value = opt;
                option.textContent = (this.options?.optionsDisplay ? this.options.optionsDisplay[idx] : opt)??null;
            });

            selectEl.value = this.orginValue;
            if(selectEl.value === '') {
                const option = selectEl.createEl('option');
                option.value = '';
                option.textContent = this.orginValue;
                option.selected = true;
            }
            this.onReset = () => {
                selectEl.value = '';
            }
            selectEl.addEventListener('change', () => {
                if(selectEl.value === '') {
                    this.setProp(this.orginValue);
                    return;
                }
                this.setProp(selectEl.value);
            });
            //添加重置按钮
            this.setting.addExtraButton(btn => btn
                .setIcon('reset')
                .onClick(() => {
                    this.reset();
                })
            );
        }
        else if (this.type === 'text') {
            this.inputEl = this.setting.controlEl.createEl('input', { type: 'text' });
            this.inputEl.value = this.orginValue;
            this.inputEl.addEventListener(this.on ?? 'input', () => {
                this.setProp(this.inputEl.value);
            });
            //添加重置按钮
            this.setting.addExtraButton(btn => btn
                .setIcon('reset')
                .onClick(() => {
                    this.reset();
                })
            );
        }
        else if (this.type === 'image-upload') {
            const fileInput = this.setting.controlEl.createEl('input', { type: 'file', cls: 'ui-designer-image-upload-input' });
            fileInput.accept = 'image/*';
            fileInput.classList.add('ui-designer-image-upload-input');


            fileInput.addEventListener('change', () => {
                    
                const file = fileInput.files?.[0];
                if (!file) return;

                // 设置css 属性
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result as string;
                    this.setProp(`url(${result})`);
                    // 存储Base64字符串到插件设置中，以便后续使用
                    // this.plugin.settings.backgroundImage = result;
                };
                // 根据需求选择读取方式：readAsText 或 readAsDataURL (用于图片)
                reader.readAsDataURL(file); 
            });
        }

        if(this.subItems.length > 0) {
            //创建一个可以展开/收起的子属性容器
            this.subContainer = this.body.createDiv({ cls: 'visual-ui-editor-sub-container' });
            //处理展开收起逻辑
            this.setting.addExtraButton(btn => btn
            .setIcon('chevron-right')
            .onClick(() => {
                const el = this.subContainer;
                const isCollapsed = !el.classList.contains('is-expanded');

                if (isCollapsed) {
                    // 测量实际高度并赋值给 CSS 变量
                    const height = el.scrollHeight;
                    el.style.setProperty('--visual-ui-editor-sub-container-height', `${height}px`);
                    el.classList.add('is-expanded');
                    //展开完成后将高度设置为 none，允许其根据内容自动调整高度
                    setTimeout(() => {
                        el.style.setProperty('--visual-ui-editor-sub-container-height', `${10000000000}px`);
                    }, 300);

                    btn.setIcon('chevron-down');
                } else {
                    // el.style.setProperty('--visual-ui-editor-sub-container-height', `${0}px`);
                    // el.classList.remove('expanded');
                    el.classList.remove('is-expanded');
                    btn.setIcon('chevron-right');
                }
            })
        );


            //递归创建子属性
            this.subItems.forEach(subItem => {
                subItem.previewEl = this.previewEl;
                subItem.body = this.subContainer;
                subItem.computedStyle = this.computedStyle;
                subItem.parentItem = this;
                if(this.onUpdate) {
                    subItem.addListenerOnUpdate(this.onUpdate);
                }
                subItem.createElement();
            });

        }
    }
}

class CSSInspectorFloatingPanel{
    constructor(
        private app: App, 
        private targetEl: HTMLElement, 
        private selectorInstance: MultiSelectorInstance,
        private plugin: VisualUIEditorPlugin
    ) {
        this.initUI();
    }
    private previewEl!: HTMLElement;
    private isDragging = false;
    private offset = { x: 0, y: 0 };
    private el!: HTMLDivElement;
    private attributeEditors: AttributeEditItem[] = [];
    private priority: number = 1; // 用于控制 CSS 优先级
    private style: string = ''; // 用于存储当前生成的 CSS 样式字符串
    private selectorHint!: HTMLDivElement; // 显示当前选择器的提示元素
    private styleEl!: HTMLStyleElement; // 用于注入样式的 <style> 标签
    private isImportant: boolean = false; // 是否使用 !important 来提高优先级
    private target_style!: CSSStyleDeclaration; // 当前元素的计算样式对象
    get pseudo() {
        return this.selectorInstance.pseudo;
    }
    get selector(): string {
        return this.selectorInstance.selector;
    }


    public open() {
        // 已经在 initUI 中创建并添加到 DOM，无需重复操作
        return this; // 方便链式调用
    }

    private exportStyle(isImportant: boolean = false): string {
        let style = '';
        this.attributeEditors.forEach(editor => {
            style += editor.exportCSS(isImportant);
        });
        style = style.replace(/;\n/g, ';\n\t');
        return style;
    }
        
    private exportCSS(priority: number = 1, isImportant: boolean = false): string {
        let css = '';
        this.attributeEditors.forEach(editor => {
            css += editor.exportCSS(isImportant);
        });
        const peudo = this.selector.split('::')[1] ?? '';
        const baseSelector = this.selector.split('::')[0] ?? this.selector;
        let repeatSelector = baseSelector.split(/\s+/).map(s => s.startsWith('.') ? Array(priority).fill(s).join('') : s).join(' ') + (peudo?`::${peudo}`:'');
        css = `${repeatSelector}{\n\t${css}}\n`
        //给;\n后面添加制表符
        css = css.replace(/;\n/g, ';\n\t').replace(/\t}/g, '}');
        return css;
    }
    
    private async forceRefreshStyles() {
        const getStyleSnapshot = (el: HTMLElement) => {
            const styles = window.getComputedStyle(el);
            const snapshot: Record<string, string> = {};
            
            // 遍历所有样式键名
            // 注意：CSSStyleDeclaration 是类数组对象，可以直接遍历
            for (let i = 0; i < styles.length; i++) {
                const key = styles[i];
                if(key === undefined) continue;
                snapshot[key] = styles.getPropertyValue(key);
            }
            return JSON.stringify(snapshot);
        };
        await this.app.customCss.readSnippets();
        
        // 轮询检查样式表是否已更新，设置最大重试次数
        let attempts = 0;
        const oldStyle = getStyleSnapshot(this.targetEl);
        while (attempts < 100) {
            // 尝试获取最新的 computedStyle
            const current = getStyleSnapshot(this.targetEl);
            if (current === oldStyle) {
                await new Promise(resolve => setTimeout(resolve, 100)); 
                attempts++;
            }
            else {
                // console.log('Styles updated successfully after', attempts, 'attempts');
                break;
            }
        }
    }
    private initUI() {
        // 创建主面板
        this.el = document.createElement('div');
        this.el.addClass('obsidian-floating-panel');

        Object.assign(this.el.style, {
            position: 'fixed',
            top: '100px',
            right: '100px',
            width: '560px',
            // height: '600px',
            zIndex: '40',
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-l)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '80vh',
            overflow: 'hidden'
        });

        // --- 拖拽手柄 ---
        const handle = this.el.createDiv({ cls: 'visual-ui-editor-drag-handle' });
        handle.textContent = '⋮ UI 样式修改器 (拖动我移动位置)';
        handle.classList.add('visual-ui-editor-title')
        // 拖拽逻辑 (使用箭头函数自动绑定 this)
        handle.onmousedown = (e) => {
            this.isDragging = true;
            this.offset.x = e.clientX - this.el.offsetLeft;
            this.offset.y = e.clientY - this.el.offsetTop;
            handle.classList.add('is-dragging');
            
            
            // 增加全局监听，防止鼠标滑出面板后断开
            const onMouseMove = (e: MouseEvent) => {
                if (!this.isDragging) return;
                this.el.style.left = `${e.clientX - this.offset.x}px`;
                this.el.style.top = `${e.clientY - this.offset.y}px`;
            };

            const onMouseUp = () => {
                this.isDragging = false;
                handle.classList.remove('is-dragging');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        
        // --- 内容区域 ---
        const body = this.el.createDiv({ cls: 'panel-body' });
        Object.assign(body.style, {
            display: 'flex',
            flexDirection: 'column',
            height: '500px', // 或者使用 calc(100vh - 头部高度)，必须有固定高度
            padding: '0',    // 内边距移交给子列
            overflow: 'hidden' // 父级不滚动，交给子列滚动
        });

        const topColumn = body.createDiv({ cls: 'panel-top' });
        Object.assign(topColumn.style, {
            flex: '0.3', // 预览区稍宽一点
            alignItems: 'center',
            justifyContent: 'center',
            overflowY: 'auto', // 独立滚动
            // borderRight: '1px solid var(--background-modifier-border)',
            display: 'flex',
            flexDirection: 'column'
        });
        const bottomColumn = body.createDiv({ cls: 'panel-bottom' });
        Object.assign(bottomColumn.style, {
            flex: '1',
            padding: '20px',
            overflowY: 'auto', // 独立滚动
            background: 'var(--background-primary-alt)' // 稍微区分一下底色
        });
        // 预览副本逻辑
        const previewContainer = topColumn.createDiv({ cls: 'preview-container' });
        const elementPreviewContainer = previewContainer.createDiv({ cls: 'element-preview-container' });
        const selectorHintContainer = previewContainer.createDiv({ cls: 'selector-hint-container' });
        
        elementPreviewContainer.addEventListener('mouseenter', () => {
            this.selectorInstance.toggleOverlays(true);
        });
        elementPreviewContainer.addEventListener('mouseleave', () => {
            this.selectorInstance.toggleOverlays(false);
        });
        
        Object.assign(previewContainer.style, {
            //左右两栏
            display: 'flex',
            width: '100%',
            height: '100%',
            // borderBottom: '1px solid var(--background-modifier-border)',
        });

        const previewTitle = elementPreviewContainer.createDiv({ cls: 'preview-hint' });
        previewTitle.textContent = '[预览] / 鼠标悬停可查看文档中的元素';
        Object.assign(previewTitle.style, {
            position: 'absolute',
            width: '100%',
            height: '100%',
            top: '5px',
            left: '5px',
            // transform: 'translateX(-50%)',
            backgroundColor: 'transparent',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: 'var(--font-smaller)',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
            zIndex: '10',
            opacity: '0.8',
        });

        Object.assign(selectorHintContainer.style, {
            width: '50%',
            height: '100%',
            padding: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--background-secondary)',
            borderBottomRightRadius: '8px',
            borderLeft: '1px solid var(--background-modifier-border)',
            borderBottom: '1px inset var(--background-modifier-border)',
            marginBottom: '0',
            position: 'relative', /* 必须加这一行 */
            overflow: 'auto',   /* 如果你不希望它捅破边界，加这一行 */
        });
        // 添加selector提示
        this.selectorHint = selectorHintContainer.createDiv({ cls: 'selector-hint' });
        selectorHintContainer.addEventListener('mousedown', (e) => {
            //把选择器提示的文本复制到剪贴板
            if(this.selectorHint.textContent?.startsWith('[@selector]')) {
                const selector = this.selector;
                navigator.clipboard.writeText(selector).then(() => {
                    new Notice(`已复制选择器: ${selector}`); 
                }).catch(err => {
                    console.error('复制失败:', err);
                    new Notice('复制失败');
                });
                return;
            }
            const css = this.exportCSS(this.priority, this.isImportant);
            navigator.clipboard.writeText(css).then(() => {
                new Notice(`已复制css代码: ${css}`); 
            }).catch(err => {
                console.error('复制失败:', err);
                new Notice('复制失败');
            });
        });
        this.selectorHint.textContent = `[@selector]/ 点击复制选择器\n${this.selector}\n`;
        Object.assign(this.selectorHint.style, {
            position: 'absolute',
            top: '5px',
            left: '50%',
            width: '100%',
            maxWidth: '230px',
            whiteSpace: 'pre-wrap',
            // textOverflow: 'ellipsis',
            // overflow: 'hidden',
            textAlign: 'left',
            transform: 'translateX(-48%)',
            backgroundColor: 'transparent',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: 'var(--font-smaller)',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
            zIndex: '40',
            opacity: '0.8',
        });

        Object.assign(elementPreviewContainer.style, {
            width: '50%',
            height: '100%',
            padding: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--background-secondary)',
            borderBottomLeftRadius: '8px',
            borderBottom: '1px inset var(--background-modifier-border)',
            marginBottom: '0',
            position: 'relative', /* 必须加这一行 */
            overflow: 'auto',   /* 如果你不希望它捅破边界，加这一行 */
        });

        this.target_style = window.getComputedStyle(this.targetEl);
        if(this.pseudo) {
            //增加上面居中提示选中了伪元素
            const hint = this.el.createDiv({ cls: 'preview-hint' });
            hint.textContent = '(提示: 选中了伪元素, 可能需要修改背景颜色来修改颜色)';
            Object.assign(hint.style, {
                position: 'absolute',
                top: '125px',
                left: '50%',
                width: '100%',
                textAlign: 'center',
                transform: 'translateX(-50%)',
                backgroundColor: 'transparent',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: 'var(--font-smaller)',
                color: 'var(--text-muted)',
                pointerEvents: 'none', // 让提示不干扰鼠标事件
                zIndex: '10'
            });

            //复制一个假的元素来展示伪元素样式
            this.previewEl?.remove();
            const target_style = window.getComputedStyle(this.targetEl);
            if(this.pseudo) {
                //增加上面居中提示选中了伪元素
                const hint = this.el.createDiv({ cls: 'preview-hint' });
                hint.textContent = '(提示: 选中了伪元素, 可能需要修改背景颜色来修改颜色)';
                Object.assign(hint.style, {
                    position: 'absolute',
                    top: '125px',
                    left: '50%',
                    width: '100%',
                    textAlign: 'center',
                    transform: 'translateX(-50%)',
                    backgroundColor: 'transparent',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: 'var(--font-smaller)',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none', // 让提示不干扰鼠标事件
                    zIndex: '10'
                });

                const pseudoStyle = window.getComputedStyle(this.targetEl, this.pseudo);
                //复制一个假的元素来展示伪元素样式
                this.previewEl = document.createElement('div');
                for (let i = 0; i < pseudoStyle.length; i++) {
                    const key = pseudoStyle[i]; // 拿到属性名，如 "color"
                    if(!key) continue;
                    if(key.startsWith('--')) continue; // 跳过 CSS 变量
                    this.previewEl.style.setProperty(key, pseudoStyle.getPropertyValue(key));
                }
            }
            else{
                this.previewEl = this.targetEl.cloneNode(true) as HTMLElement;   
                for (const key of target_style) {
                    this.previewEl.style.setProperty(
                        key, 
                        target_style.getPropertyValue(key), 
                        target_style.getPropertyPriority(key) 
                    );
                }
            }
        }
        else{
            this.previewEl = this.targetEl.cloneNode(true) as HTMLElement;   
            for (const key of this.target_style) {
                this.previewEl.style.setProperty(
                    key, 
                    this.target_style.getPropertyValue(key), 
                    this.target_style.getPropertyPriority(key) 
                );
            }
        }

        
        elementPreviewContainer.appendChild(this.previewEl);
        // --- 属性编辑区 ---
        const props: UISetting[] = [
            { name: '背景', prop: 'background', type: 'text',
                subs: [
                    { name: '背景颜色', prop: 'background-color', type: 'color' },
                    { name: '背景图片', prop: 'background-image', type: 'image-upload' },
                    { name: '平铺方式', prop: 'background-repeat', type: 'select', options: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'], optionsDisplay: ['不平铺', '平铺', '横向平铺', '纵向平铺'] },
                    { name: '缩放方式', prop: 'background-size', type: 'select', options: ['auto', 'cover', 'contain'], optionsDisplay: ['原始', '优先铺满容器', '优先展示全图'] },
                    { name: '对齐位置', prop: 'background-position', type: 'select', options: ['center', 'top', 'bottom', 'left', 'right'], optionsDisplay: ['居中', '靠顶', '靠底', '靠左', '靠右'] },
                    { name: '背景混合模式', prop: 'background-blend-mode', type: 'select',options: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'],optionsDisplay: ['正常', '正片叠底', '滤色', '叠加', '变暗', '变亮']},
                    { name: '背景滚动模式', prop: 'background-attachment', type: 'select', options: ['scroll', 'fixed', 'local'], optionsDisplay: ['随内容滚动', '固定', '随元素滚动'] },
                    { name: '背景位置', prop: 'background-origin', type: 'select', options: ['padding-box', 'border-box', 'content-box'], optionsDisplay: ['内边距区左上角', '边框区左上角', '内容区左上角'] },
                    { name: '背景裁剪', prop: 'background-clip', type: 'select', options: ['border-box', 'padding-box', 'content-box'], optionsDisplay: ['边框区', '内边距区', '内容区'] },
                ]
            },
            { name: '颜色', prop: 'color', type: 'color', also: ['-webkit-text-fill-color', '-webkit-text-stroke-color'] },
            { name: '透明度', prop: 'opacity', type: 'slider', min: 0, max: 1, step: 0.1, unit: '' },
            { name: '字体', prop: 'font-family', type: 'font' ,
                subs: [
                    { name: '字体大小', prop: 'font-size', type: 'slider', min: 10, max: 36, unit: 'px' },
                    // { name: '字体颜色', prop: 'color', type: 'color', also: '-webkit-text-fill-color'},
                    { name: '字体样式', prop: 'font-style', type: 'select', options: ['normal', 'italic', 'oblique'], optionsDisplay: ['正常', '斜体', '强制倾斜'] },
                    { name: '字体粗细', prop: 'font-weight', type: 'select', options: ['normal', 'bold', 'bolder', 'lighter'], optionsDisplay: ['正常', '加粗', '超粗', '细'] },
                    { name: '行高', prop: 'line-height', type: 'slider', min: 1, max: 3, step: 0.1, unit: '' },
                    { name: '字间距', prop: 'letter-spacing', type: 'slider', min: -5, max: 20, unit: 'px' },
                    { name: '文字对齐', prop: 'text-align', type: 'select', options: ['left', 'right', 'center', 'justify','start','end','match-parent'], optionsDisplay: ['左对齐', '右对齐', '居中对齐', '两端对齐', '起始位置', '末尾位置', '匹配父元素'] },
                    { name: '装饰线', prop: 'text-decoration', type: 'text', 
                        subs: [
                            { name: '线条', prop: 'text-decoration-line', type: 'select', options: ['none', 'underline', 'overline', 'line-through'], optionsDisplay: ['无', '下划线', '上划线', '删除线'] },
                            { name: '颜色', prop: 'text-decoration-color', type: 'color' },
                            { name: '样式', prop: 'text-decoration-style', type: 'select', options: ['solid', 'dashed', 'dotted','double','wavy'], optionsDisplay: ['实线', '虚线', '点线','双线','波浪线'] },
                            { name: '粗细', prop: 'text-decoration-thickness', type: 'slider', min: 0, max: 10, unit: 'px' },
                            
                            { name: '偏移', prop: 'text-underline-offset', type: 'slider', min: -20, max: 20, unit: 'px' },
                            { name: '跳过字母垂足', prop: 'text-decoration-skip-ink', type: 'select', options: ['auto', 'none'], optionsDisplay: ['自动', '无'] },
                        ]
                    },
                    { name: '文字换行', prop: 'white-space', type: 'select', options: ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'], optionsDisplay: ['正常', '不换行', '保留空白', '保留空白并换行', '合并空白并换行']},
                    { name: '文本溢出处理', prop: 'text-overflow', type: 'select',options: ['clip', 'ellipsis'],optionsDisplay: ['裁剪', '省略号']},
                    { name: '文本阴影', default:'', role: 'shorthand', prop: 'text-shadow', type: 'text',
                        subs: [
                            { name: '水平偏移',role: 'part-1', default: "0px", prop: '', type: 'slider', min: -20, max: 20, unit: 'px' },
                            { name: '垂直偏移',role: 'part-2', default: "0px", prop: '', type: 'slider', min: -20, max: 20, unit: 'px' },
                            { name: '模糊半径',role: 'part-3', default: "0px", prop: '', type: 'slider', min: 0, max: 20, unit: 'px' },
                            { name: '阴影颜色',role: 'part-4', default: "rgba(0, 0, 0, 0.5)", prop: '', type: 'color' },
                        ]
                    }
                ]
            },
            { name: '边框', prop: 'border', type: 'text',
                subs: [
                    { name: '边框宽度', prop: 'border-width', type: 'slider', min: 0, max: 10, unit: 'px',
                        subs: [
                            { name: '上', prop: 'border-top-width', type: 'slider', min: 0, max: 10, unit: 'px' },
                            { name: '右', prop: 'border-right-width', type: 'slider', min: 0, max: 10, unit: 'px' },
                            { name: '下', prop: 'border-bottom-width', type: 'slider', min: 0, max: 10, unit: 'px' },
                            { name: '左', prop: 'border-left-width', type: 'slider', min: 0, max: 10, unit: 'px' },
                        ]
                    },
                    { name: '边框样式', prop: 'border-style', type: 'select', options: ['none', 'solid', 'dashed', 'dotted','double','groove','ridge','inset','outset'], optionsDisplay: ['无', '实线', '虚线', '点线','双线','凹槽','脊线','内嵌','外嵌'],
                        subs: [
                            { name: '上', prop: 'border-top-style', type: 'select', options: ['none', 'solid', 'dashed', 'dotted','double','groove','ridge','inset','outset'], optionsDisplay: ['无', '实线', '虚线', '点线','双线','凹槽','脊线','内嵌','外嵌'] },
                            { name: '右', prop: 'border-right-style', type: 'select', options: ['none', 'solid', 'dashed', 'dotted','double','groove','ridge','inset','outset'], optionsDisplay: ['无', '实线', '虚线', '点线','双线','凹槽','脊线','内嵌','外嵌'] },
                            { name: '下', prop: 'border-bottom-style', type: 'select', options: ['none', 'solid', 'dashed', 'dotted','double','groove','ridge','inset','outset'], optionsDisplay: ['无', '实线', '虚线', '点线','双线','凹槽','脊线','内嵌','外嵌'] },
                            { name: '左', prop: 'border-left-style', type: 'select', options: ['none', 'solid', 'dashed', 'dotted','double','groove','ridge','inset','outset'], optionsDisplay: ['无', '实线', '虚线', '点线','双线','凹槽','脊线','内嵌','外嵌'] },
                        ]
                    },
                    { name: '边框颜色', prop: 'border-color', type: 'color',
                        subs: [
                            { name: '上', prop: 'border-top-color', type: 'color' },
                            { name: '右', prop: 'border-right-color', type: 'color' },
                            { name: '下', prop: 'border-bottom-color', type: 'color' },
                            { name: '左', prop: 'border-left-color', type: 'color' },
                        ]
                    },
                    { name: '圆角', prop: 'border-radius', type: 'slider', min: 0, max: 50, unit: 'px', 
                        subs: [
                            { name: '左上', prop: 'border-top-left-radius', type: 'slider', min: 0, max: 50, unit: 'px' },
                            { name: '右上', prop: 'border-top-right-radius', type: 'slider', min: 0, max: 50, unit: 'px' },
                            { name: '右下', prop: 'border-bottom-right-radius', type: 'slider', min: 0, max: 50, unit: 'px' },
                            { name: '左下', prop: 'border-bottom-left-radius', type: 'slider', min: 0, max: 50, unit: 'px' },
                        ]
                    },
                ]
            },
            { name: '内边距', prop: 'padding', type: 'slider', min: 0, max: 100, unit: 'px',
                subs: [
                    { name: '上', prop: 'padding-top', type: 'slider', min: 0, max: 100, unit: 'px' },
                    { name: '右', prop: 'padding-right', type: 'slider', min: 0, max: 100, unit: 'px' },
                    { name: '下', prop: 'padding-bottom', type: 'slider', min: 0, max: 100, unit: 'px' },
                    { name: '左', prop: 'padding-left', type: 'slider', min: 0, max: 100, unit: 'px' },
                ]
            },
            { name: '外边距', prop: 'margin', type: 'slider', min: 0, max: 100, unit: 'px',
                subs: [
                    { name: '上', prop: 'margin-top', type: 'slider', min: 0, max: 100, unit: 'px' },
                    { name: '右', prop: 'margin-right', type: 'slider', min: 0, max: 100, unit: 'px' },
                    { name: '下', prop: 'margin-bottom', type: 'slider', min: 0, max: 100, unit: 'px' },
                    { name: '左', prop: 'margin-left', type: 'slider', min: 0, max: 100, unit: 'px' },
                ]
            },
            {
                name: '高级属性 [ 需要css知识 ]', prop: '', type: 'none',
                subs: [
                    { name: '尺寸', prop: '', type: 'none',
                        subs: [
                            { name: '宽度', prop: 'width', type: 'slider', min: 0, max: 1000, unit: 'px' },
                            { name: '高度', prop: 'height', type: 'slider', min: 0, max: 1000, unit: 'px' },
                            { name: '最小宽度', prop: 'min-width', type: 'slider', min: 0, max: 1000, unit: 'px' },
                            { name: '最小高度', prop: 'min-height', type: 'slider', min: 0, max: 1000, unit: 'px' },
                            { name: '最大宽度', prop: 'max-width', type: 'slider', min: 0, max: 1000, unit: 'px' },
                            { name: '最大高度', prop: 'max-height', type: 'slider', min: 0, max: 1000, unit: 'px' }
                        ]
                    },
                    { name: '布局', prop: 'display', type: 'select', options: ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid'], optionsDisplay: ['块级', '行内块', '行内', '弹性布局', '行内弹性布局', '网格布局', '行内网格布局'],
                        subs: [
                            { name: '弹性方向', prop: 'flex-direction', type: 'select', options: ['row', 'row-reverse', 'column', 'column-reverse'], optionsDisplay: ['横向', '横向反序', '纵向', '纵向反序'] },
                            { name: '主轴对齐方式', prop: 'justify-content', type: 'select', options: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch', 'start', 'end', 'left', 'right'], optionsDisplay: ['起点对齐', '终点对齐', '居中', '两端对齐', '环绕对齐', '平均对齐', '拉伸填满', '起始位置对齐', '末尾位置对齐', '左对齐', '右对齐'] },
                            { name: '交叉轴对齐方式', prop: 'align-items', type: 'select', options: ['stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end'], optionsDisplay: ['拉伸填满', '起点对齐', '终点对齐', '居中', '基线对齐', '起始位置对齐', '末尾位置对齐', '自身起始位置对齐', '自身末尾位置对齐'] },
                            { name: '换行', prop: 'flex-wrap', type: 'select', options: ['nowrap', 'wrap', 'wrap-reverse'], optionsDisplay: ['不换行', '换行', '反向换行'] },
                            
                            { name: '网格列数', on:'block', prop: 'grid-template-columns', type: 'text' },
                            { name: '网格行数', on:'block', prop: 'grid-template-rows', type: 'text' },
                            { name: '行间距', on:'block', prop: 'grid-row-gap', type: 'slider', min: 0, max: 50, unit: 'px' },
                            { name: '列间距', on:'block', prop: 'grid-column-gap', type: 'slider', min: 0, max: 50, unit: 'px' },
                            
                            { name: '子项排序',on:'flex', prop: 'order', type: 'slider', min: -10, max: 10, unit: '' },
                            { name: '伸缩比例',on:'flex', prop: 'flex-grow', type: 'slider', min: 0, max: 5, unit: '' },
                            { name: '收缩比例',on:'flex', prop: 'flex-shrink', type: 'slider', min: 0, max: 5, unit: '' },
                            { name: '基础尺寸',on:'flex', prop: 'flex-basis', type: 'slider', min: 0, max: 500, unit: 'px' },
                        ]
                    },
                    { name: '定位', prop: 'position', type: 'select', options: ['static', 'relative', 'absolute', 'fixed', 'sticky'], optionsDisplay: ['默认', '相对定位', '绝对定位', '固定定位', '粘性定位'],
                        subs: [
                            { name: '层级', prop: 'z-index', type: 'slider', min: 0, max: 9999, unit: '' },
                            { name: '上偏移', prop: 'top', type: 'slider', min: -500, max: 500, unit: 'px' },
                            { name: '下偏移', prop: 'bottom', type: 'slider', min: -500, max: 500, unit: 'px' },
                            { name: '左偏移', prop: 'left', type: 'slider', min: -500, max: 500, unit: 'px' },
                            { name: '右偏移', prop: 'right', type: 'slider', min: -500, max: 500, unit: 'px' }
                        ]
                    },
                    { name: '滤镜&特效', prop: '', type: 'none',
                        subs: [
                            { name: '阴影', default:'', role:'shorthand', prop: 'box-shadow', type: 'text',
                                subs: [
                                    { name: '水平偏移', role:'part-1',default: "0px", prop: '', type: 'slider', min: -20, max: 20, unit: 'px'},
                                    { name: '垂直偏移', role:'part-2',default: "0px", prop: '', type: 'slider', min: -20, max: 20, unit: 'px'},
                                    { name: '模糊半径', role:'part-3',default: "0px", prop: '', type: 'slider', min: 0, max: 20, unit: 'px'},
                                    { name: '阴影颜色', role:'part-4',default: "rgba(0, 0, 0, 0.5)", prop: '', type: 'color'},
                                ]
                            },
                            { name: '前景', default:'', role:'functionalNotion', prop: 'filter', type: 'text' ,
                                subs: [
                                    { name: '模糊',role:'part',default: "0px", prop: 'blur', type: 'slider', min: 0, max: 20, unit: 'px' },
                                    { name: '亮度',role:'part',default: "100%", prop: 'brightness', type: 'slider', min: 0, max: 200, unit: '%' },
                                    { name: '对比度',role:'part',default: "100%", prop: 'contrast', type: 'slider', min: 0, max: 200, unit: '%' },
                                    { name: '灰度',role:'part',default: "0%", prop: 'grayscale', type: 'slider', min: 0, max: 100, unit: '%' },
                                    { name: '反转',role:'part',default: "0%", prop: 'invert', type: 'slider', min: 0, max: 100, unit: '%' },
                                    { name: '饱和度',role:'part',default: "100%", prop: 'saturate', type: 'slider', min: 0, max: 200, unit: '%' },
                                ]
                            },
                            { name: '背景', default:'', role:'functionalNotion', prop: 'backdrop-filter', type: 'text' ,
                                subs: [
                                    { name: '模糊',role:'part',default: "0px", prop: 'blur', type: 'slider', min: 0, max: 20, unit: 'px' },
                                    { name: '亮度',role:'part',default: "100%", prop: 'brightness', type: 'slider', min: 0, max: 200, unit: '%' },
                                    { name: '对比度',role:'part',default: "100%", prop: 'contrast', type: 'slider', min: 0, max: 200, unit: '%' },
                                    { name: '灰度',role:'part',default: "0%", prop: 'grayscale', type: 'slider', min: 0, max: 100, unit: '%' },
                                    { name: '反转',role:'part',default: "0%", prop: 'invert', type: 'slider', min: 0, max: 100, unit: '%' },
                                    { name: '饱和度',role:'part',default: "100%", prop: 'saturate', type: 'slider', min: 0, max: 200, unit: '%' },
                                ]
                            },
                        ]
                    },
                    { name: '变换', prop: 'transform', type: 'text',
                        subs: [
                            { name: '旋转', prop: 'rotate', type: 'slider', min: -360, max: 360, unit: 'deg' },
                            { name: '缩放', prop: 'scale', type: 'slider', min: 0.1, max: 3, step: 0.1, unit: '' },
                            { name: '水平平移', prop: 'translateX', type: 'slider', min: -200, max: 200, unit: 'px' },
                            { name: '垂直平移', prop: 'translateY', type: 'slider', min: -200, max: 200, unit: 'px' },
                        ]
                    }
                ]
            },
            
        ];
        this.attributeEditors = props.map((p: UISetting) => new AttributeEditItem(
            p.name, 
            p.prop, 
            p.type as 'slider' | 'color' | 'font' | 'text' | 'select' | 'image-upload', 
            { min: p.min, max: p.max, step: p.step, unit: p.unit, options: p.options, optionsDisplay: p.optionsDisplay ,default: p.default}, 
            p.subs as UISetting[],
            p.on,
            p.also,
            p.role,
            this.previewEl, 
            bottomColumn,
            this.target_style
        ));
        

        this.attributeEditors.forEach(editor => editor.createElement());

        this.attributeEditors.forEach(editor => editor.addListenerOnUpdate(
            () => {
                this.style = this.exportStyle(this.isImportant);
                if(this.style.endsWith("\t")) {
                    this.style = this.style.slice(0, -1);
                }
                if(this.style === '') {
                    this.selectorHint.textContent = `[@selector]/ 点击复制选择器\n${this.selector}\n`;
                }
                else {
                    this.selectorHint.textContent = `[@css-preview]/ 点击复制css代码\n${this.selector}\n{\n\t${this.style}}`;
                }
            }
        )); // 初始化时同步一次预览


        
        
        // 5. 底部操作栏
        const setting = new Setting(this.el)
            
            // .setName('查看选择器')
            // .addToggle(toggle => toggle
            //     .setValue(true) // 设置初始状态
            //     .onChange(value => {
            //         this.selectorInstance.toggleOverlays(value);
            //     })
            // )
            .setName('覆盖权重')
            .setTooltip('当多个样式作用于同一元素时，权重更高的样式会覆盖权重较低的样式。默认权重为1，数值越大优先级越高。')
            .setDesc('')
            .setClass('visual-ui-editor-weight-setting')
            .then(setting => {
                // 1. 初始化数据
                const min = 1, max = 30, step = 1;
                let currentWeight = this.priority || 1; 

                // 2. 创建显示容器 (Stack)
                const displayStack = setting.controlEl.createDiv({ cls: 'value-display-stack' });
                Object.assign(displayStack.style, {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'end',
                    width: '60px',
                    marginRight: '10px'
                });

                // 3. 创建显示文本 (Span)
                const valueDisplay = displayStack.createEl('span', {
                    text: String(currentWeight),
                    cls: 'visual-ui-editor-value-display-label'
                });

                // 4. 创建隐藏输入框 (Input)
                const valueInput = displayStack.createEl('input', {
                    type: 'number',
                    cls: 'visual-ui-editor-value-input'
                });         

                // 5. 添加原生 Slider
                setting
                    .addSlider(slider => slider
                    .setLimits(min, max, step)
                    .setValue(currentWeight)
                    .onChange(value => {
                        this.priority = value; // 同步到你的实例变量
                        // 执行你的逻辑，比如刷新选择器
                        // this.selectorInstance.updatePriority(value);
                    })
                )
                .addToggle(toggle => {
                            toggle
                            .setValue(this.isImportant) // 设置初始状态
                            const statusText = toggle.toggleEl.createEl('span', { 
                                text: toggle.getValue() ? '强制' : '强制',
                                cls: 'visual-ui-editor-important-status-text'
                            });
                            
                            toggle.onChange(value => {
                                this.isImportant = value;
                                statusText.setText(value ? '强制' : '强制');
                                statusText.classList.toggle('important', value);
                                this.style = this.exportStyle(this.isImportant);
                                if(this.style.endsWith("\t")) {
                                    this.style = this.style.slice(0, -1);
                                }
                                if(this.style === '') {
                                    this.selectorHint.textContent = `[@selector]/ 点击复制选择器\n${this.selector}\n`;
                                }
                                else {
                                    this.selectorHint.textContent = `[@css-preview]/ 点击复制css代码\n${this.selector}\n{\n\t${this.style}}`;
                                }
                            });
                        }
                    )
                    ;
                const _sliderInput = setting.controlEl.querySelector('input[type="range"]') as HTMLInputElement;
                    if (_sliderInput) {
                        _sliderInput.addEventListener('input', () => {
                            const val = _sliderInput.value;
                            currentWeight = parseInt(val);
                            // 实时更新显示文字
                            valueDisplay.textContent = val;
                            valueInput.value = val;
                            // 如果需要实时预览效果，也可以在这里调用更新逻辑
                            // this.selectorInstance.updatePriority(currentWeight);
                        });
                    }


                // 获取刚才 addSlider 创建的 input 实例用于联动
                const sliderInput = setting.controlEl.querySelector('input[type="range"]') as HTMLInputElement;

                // 6. 绑定点击切换逻辑
                valueDisplay.addEventListener('click', () => {
                    valueDisplay.classList.remove('visual-ui-editor-visible');
                    valueDisplay.classList.add('visual-ui-editor-hidden');
                    valueInput.classList.remove('visual-ui-editor-hidden');
                    valueInput.classList.add('visual-ui-editor-visible');
                    valueInput.value = String(currentWeight);
                    valueInput.focus();
                });

                const confirmEdit = () => {
                    let newValue = parseInt(valueInput.value);
                    if (!isNaN(newValue)) {
                        // 限制边界
                        newValue = Math.max(min, Math.min(max, newValue));
                        currentWeight = newValue;
                        valueDisplay.textContent = String(newValue);
                        
                        // 联动 Slider
                        if (sliderInput) sliderInput.value = String(newValue);
                        
                        // 触发逻辑更新
                        this.priority = newValue;
                        // this.selectorInstance.updatePriority(newValue);
                    }
                    valueInput.classList.remove('visual-ui-editor-visible');
                    valueInput.classList.add('visual-ui-editor-hidden');
                    valueDisplay.classList.remove('visual-ui-editor-hidden');
                    valueDisplay.classList.add('visual-ui-editor-visible');
                };

                valueInput.addEventListener('blur', confirmEdit);
                valueInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') confirmEdit();
                    if (e.key === 'Escape') {
                        valueInput.classList.remove('visual-ui-editor-visible');
                        valueInput.classList.add('visual-ui-editor-hidden');
                        valueDisplay.classList.remove('visual-ui-editor-hidden');
                        valueDisplay.classList.add('visual-ui-editor-visible');
                    }
                });

                // // 7. 添加重置按钮
                // setting.addExtraButton(btn => btn
                //     .setIcon('reset')
                //     .setTooltip('重置权重')
                //     .onClick(() => {
                //         const defaultVal = 1;
                //         currentWeight = defaultVal;
                //         valueDisplay.textContent = String(defaultVal);
                //         if (sliderInput) sliderInput.value = String(defaultVal);
                //         this.priority = defaultVal;
                //         // this.selectorInstance.updatePriority(defaultVal);
                //     })
                // );
            })
            
            .addButton(btn => btn
                .setButtonText('抹除样式')
                .setWarning()
                .setTooltip('抹除所有该元素设置过的历史样式，恢复到未设置状态')
                .onClick(async () => {
                    //弹出确认框
                    if(await ConfirmModal.confirm(this.app, '确定要抹除所有该元素设置过的 [历史] 样式吗？\n该元素将恢复为没有设置过任何样式的状态, 该操作无法撤销！')){
                    // if(confirm('确定要抹除所有该元素设置过的 [历史] 样式吗？\n该元素将恢复为没有设置过任何样式的状态, 该操作无法撤销！')) {
                    // window.confirm('确定要抹除所有该元素设置过的 [历史] 样式吗？\n该元素将恢复为没有设置过任何样式的状态, 该操作无法撤销！').then(async () => {
                        //读取css文件，删除所有包含该选择器的样式
                        let needRefresh = false;
                        const snippetsPath = this.app.vault.configDir + '/snippets';
                        const tempName = `--ui-designer-${this.app.vault.getName()}-temp`;
                        const tempFile = `${snippetsPath}/${tempName}.css`;
                        await this.app.vault.adapter.exists(tempFile).then(async exists => {
                            if (exists) {
                                await this.app.vault.adapter.read(tempFile).then(async content => {
                                    //匹配选择器及其样式块的正则表达式，支持多行和嵌套大括号
                                    const regex = new RegExp(`${this.selector}\\s*{[^{}]*}\n*`, 'g');
                                    //检测有没有匹配项
                                    
                                    //匹配两行以及以上的空行，并替换为一行
                                    
                                    if(regex.test(content)) {
                                        needRefresh = true;
                                        const newContent = content.replace(regex, '');
                                        const emptyLinesRegex = /\n{2,}/g;
                                        const finalContent = newContent.replace(emptyLinesRegex, '\n\n');
                                        await this.app.vault.adapter.write(tempFile, finalContent).then(async () => {
                                            await this.app.customCss.readSnippets().then(() => {
                                                needRefresh = true;
                                            });
                                        });
                                    }
                                });
                            }
                        });
                        const snippetName = `--ui-designer-${this.app.vault.getName()}-default`;
                        const snippetFile = `${snippetsPath}/${snippetName}.css`;
                        await this.app.vault.adapter.read(snippetFile).then(async content => {
                            //匹配选择器及其样式块的正则表达式，支持多行和嵌套大括号
                            const regex = new RegExp(`${this.selector}\\s*{[^{}]*}\n*`, 'g');
                            if(regex.test(content)) {
                                needRefresh = true;
                            }
                            const newContent = content.replace(regex, '');
                            const emptyLinesRegex = /\n{2,}/g;
                            const finalContent = newContent.replace(emptyLinesRegex, '\n\n');
                            await this.app.vault.adapter.write(snippetFile, finalContent).then(async () => {
                                // 刷新 Snippets 列表
                                if (needRefresh) {
                                    await this.forceRefreshStyles();

                                    new Notice('✅已抹除该元素的历史样式');
                                    this.target_style = window.getComputedStyle(this.targetEl);
                                    this.previewEl.remove();
                                    this.previewEl = this.targetEl.cloneNode(true) as HTMLElement;
                                    elementPreviewContainer.appendChild(this.previewEl);
                                    this.attributeEditors.forEach(editor => {editor.rebind(this.target_style, this.previewEl)});

                                    //应用样式
                                    for (const key of this.target_style) {
                                    this.previewEl.style.setProperty(
                                        key, 
                                        this.target_style.getPropertyValue(key), 
                                        this.target_style.getPropertyPriority(key) 
                                    );
                                    }
                                }
                                else {
                                    new Notice('✅没有发现该元素的历史样式');
                                    elementPreviewContainer.appendChild(this.previewEl);
                                    // previewContainer.
                                }
                            });
                        });

                        
                    }
                })
            )
            .addButton(btn => btn
            .setButtonText('重置')
            .setTooltip('重置此次编辑的所有样式')
            .onClick(async () => {
                //弹出确认框
                // new ConfirmModal(this.app, '确定要重置本次打开面板以来编辑的所有样式吗？历史样式将会保留', async () => {
                //
                if(await ConfirmModal.confirm(this.app, '确定要重置本次打开面板以来编辑的所有样式吗？历史样式将会保留')) {
                    this.attributeEditors.forEach(editor => editor.reset());
                    this.style = '';
                    this.selectorHint.textContent = `[@selector]/ 点击复制选择器\n${this.selector}\n`;
                    //删除临时预览样式
                    const snippetsPath = this.app.vault.configDir + '/snippets';
                    const snippetName = `--ui-designer-${this.app.vault.getName()}-temp`;
                    const snippetFile = `${snippetsPath}/${snippetName}.css`;
                    await this.app.vault.adapter.exists(snippetFile).then(async exists => {
                        if (exists) {
                                await this.app.vault.adapter.remove(snippetFile).then(async () => {
                                // 刷新 Snippets 列表
                                await this.forceRefreshStyles();

                                new Notice('✅已重置本次编辑的样式');
                                this.target_style = window.getComputedStyle(this.targetEl);
                                this.attributeEditors.forEach(editor => {editor.rebind(this.target_style, this.previewEl)});
                                this.previewEl.remove();
                                this.previewEl = this.targetEl.cloneNode(true) as HTMLElement;
                                elementPreviewContainer.appendChild(this.previewEl);
                            });
                        }
                    });
                    
                }
            }))


            .addButton(btn => btn
            .setButtonText('文档预览')
            .setTooltip('将当前样式直接应用到文档中进行预览（刷新或关闭窗口后失效）')
            .onClick(async () => {
                const css = this.exportCSS(this.priority, this.isImportant);
                // 获取 snippets 文件夹路径
                const snippetsPath = this.app.vault.configDir + '/snippets';
                if (!(await this.app.vault.adapter.exists(snippetsPath))) {
                    await this.app.vault.adapter.mkdir(snippetsPath);
                }
                const snippetName = `--ui-designer-${this.app.vault.getName()}-temp`;
                const snippetFile = `${snippetsPath}/${snippetName}.css`;
                let content = '';
                content = '/* -- This file is generated by the visual-ui-editor plugin automatically -- */\n';

                const cssContent = `${content}\n${css}`;

                await this.app.vault.adapter.write(snippetFile, cssContent);
                const customCss = this.app.customCss;

                await customCss.readSnippets();

                // 2. 检查是否在启用列表中
                const isEnabled = customCss.enabledSnippets.has(snippetName);

                if (isEnabled) {
                    // 3. 如果已启用，通过“开关一次”来强制浏览器重绘样式
                    await customCss.setCssEnabledStatus(snippetName, false);
                    await customCss.setCssEnabledStatus(snippetName, true);
                } else {
                    // 4. 如果未启用，直接开启
                    await customCss.setCssEnabledStatus(snippetName, true);
                }
                // customCss.setCssEnabledStatus(snippetName, true)
                new Notice('已应用✅\n临时css文件路径: ' + snippetFile);
            }))

            .addButton(btn => btn
            .setButtonText('保存')
            .setTooltip('将样式永久保存')
            .setWarning()
            .onClick(async () => {
                const css = this.exportCSS(this.priority, this.isImportant);
                // 获取 snippets 文件夹路径
                const snippetsPath = this.app.vault.configDir + '/snippets';
                if (!(await this.app.vault.adapter.exists(snippetsPath))) {
                    await this.app.vault.adapter.mkdir(snippetsPath);
                }
                const snippetName = `--ui-designer-${this.app.vault.getName()}-default`;
                const snippetFile = `${snippetsPath}/${snippetName}.css`;
                const result = await this.app.vault.adapter.list(snippetsPath);
                const snippetFiles = result.files; // 获取文件列表
                let content = '';

                if(snippetFiles.includes(snippetFile)) {
                    content = await this.app.vault.adapter.read(snippetFile).catch(() => '');
                }
                else {
                    content = '/* -- This file is generated by the visual-ui-editor plugin automatically -- */\n';
                }
                const cssContent = `${content}\n${css}`;

                await this.app.vault.adapter.write(snippetFile, cssContent);
                const customCss = this.app.customCss;

                await customCss.readSnippets();

                // 2. 检查是否在启用列表中
                const isEnabled = customCss.enabledSnippets.has(snippetName);

                if (isEnabled) {
                    // 3. 如果已启用，通过“开关一次”来强制浏览器重绘样式
                    await customCss.setCssEnabledStatus(snippetName, false);
                    await customCss.setCssEnabledStatus(snippetName, true);
                } else {
                    // 4. 如果未启用，直接开启
                    await customCss.setCssEnabledStatus(snippetName, true);
                }
                // customCss.setCssEnabledStatus(snippetName, true)
                new Notice('已保存✅\ncss文件路径: ' + snippetFile);
                const tempName = `--ui-designer-${this.app.vault.getName()}-temp`;
                const tempFile = `${snippetsPath}/${tempName}.css`;
                await this.app.vault.adapter.exists(tempFile).then(async exists => {
                    if (exists) {
                        await this.app.vault.adapter.remove(tempFile).then(async () => {
                            // 刷新 Snippets 列表
                            await this.app.customCss.readSnippets().then(() => {
                                // new Notice('✅已删除临时预览样式');
                            });
                        });
                    }
                });
                this.selectorInstance.cancel(); // 关闭选择器覆盖层
                this.destroy();
            }));
        setting.nameEl.classList.add('visual-ui-editor-setting-name');
        setting.descEl.classList.add('visual-ui-editor-setting-desc');

        // --- 关闭按钮 ---
        const closeBtn = handle.createEl('span', { text: '×' });
        Object.assign(closeBtn.style, { float: 'right', cursor: 'pointer' });
        closeBtn.onclick = async () => {
            if(this.style === '') {
                //删除临时预览样式
                const snippetsPath = this.app.vault.configDir + '/snippets';
                const snippetName = `--ui-designer-${this.app.vault.getName()}-temp`;
                const snippetFile = `${snippetsPath}/${snippetName}.css`;
                await this.app.vault.adapter.exists(snippetFile).then(async exists => {
                    if (exists) {
                        await this.app.vault.adapter.remove(snippetFile).then(async () => {
                            // 刷新 Snippets 列表
                            await this.app.customCss.readSnippets().then(() => {
                                // new Notice('✅已删除临时预览样式');
                            });
                        });
                    }
                });
                this.selectorInstance.cancel(); // 关闭选择器覆盖层
                this.destroy();
                return;
            }

           
            if(await ConfirmModal.confirm(this.app,'确定要关闭预览面板吗？未保存的样式将会丢失！')) {
                //删除临时预览样式
                const snippetsPath = this.app.vault.configDir + '/snippets';
                const snippetName = `--ui-designer-${this.app.vault.getName()}-temp`;
                const snippetFile = `${snippetsPath}/${snippetName}.css`;
                await this.app.vault.adapter.exists(snippetFile).then(async exists => {
                    if (exists) {
                        await this.app.vault.adapter.remove(snippetFile).then(async () => {
                            // 刷新 Snippets 列表
                            await this.app.customCss.readSnippets().then(() => {
                                // new Notice('✅已删除临时预览样式');
                            });
                        });
                    }
                });
                this.selectorInstance.cancel(); // 关闭选择器覆盖层
                this.destroy();
            }
        };

        document.body.appendChild(this.el);
    }

    public setPosition(x: number, y: number) {
        //检测是否出界面右侧和底部，如果出界则置于另一边
        const panelRect = this.el.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        // const viewportHeight = window.innerHeight;

        // let final_x = x + 50;
        // let final_y = 100;
        if (x + panelRect.width > viewportWidth) {
            this.el.style.right = `${viewportWidth - x + 50}px`
        }
        else {
            this.el.style.left = `${x+50}px`;
        }

        this.el.style.top = `${y}px`;
        return this; // 方便链式调用
    }

    public destroy() {
        this.el.remove();
        this.styleEl?.remove();
    }
}

class MultiSelectorInstance {
    private overlays: HTMLDivElement[] = [];
    private lastClassName: string = "";
    private frozen: boolean = false;
    private updateInterval: number | null = null;
    private mouseEl: HTMLElement | null = null;
    private showOverlays: boolean = true;
    public selector: string = '';
    private mousePos: { x: number, y: number } = { x: 0, y: 0 };
    public pseudo: string | null = null;

    constructor(private app: App, public pugin: VisualUIEditorPlugin) {
        this.setupListeners();
    }

    private setupListeners() {
        document.addEventListener('mousemove', this.onMouseMove, true);
        document.addEventListener('click', this.onClick, {capture: true});

        this.updateInterval = window.setInterval(() => {
            if(this.showOverlays) {
                this.update();
            }
        }, 50);

        //鼠标右键 或 Esc 键取消选择
        document.addEventListener('contextmenu', this.cancel, true);
        document.addEventListener('keydown', this.cancel, true);
    }

    //set方法
    public toggleOverlays = (show: boolean) => {
        this.showOverlays = show;
        if (show) {
            this.update();
        } else {
            this.clearOverlays();
        }
    }

    public cancel = () => {
        this.destroy();
    }

    private getMousePseudoTarget(): string | null {
        if (!this.mouseEl) return null;

        // 检查 before 和 after
        const pseudos = ['::before', '::after', '::marker'] as const;
        
        for (const pseudo of pseudos) {

            const style = window.getComputedStyle(this.mouseEl, pseudo);
            const content = style.getPropertyValue('content');
            // 如果伪元素没有内容或被隐藏，跳过
            if (!content || content === 'none') continue;

            // 获取宿主元素的位置
            const rect = this.mouseEl.getBoundingClientRect();
            
            // 拿到伪元素相对于宿主元素的偏移和尺寸
            // 注意：这里拿到的通常是计算后的像素值
            let top = parseFloat(style.top);
            let left = parseFloat(style.left);
            let width = parseFloat(style.width)+10;
            let height = parseFloat(style.height)+10;
            if(Number.isNaN(top) && Number.isNaN(left)) {
                // 如果 top 和 left 都是 auto 或无法解析，说明伪元素可能是相对于宿主元素的默认位置（如 ::before 在内容前，::after 在内容后）
                if(pseudo === '::before') {
                    top = 5;
                    left = -5;
                    width += 10;
                    height += 40;
                }
                else if(pseudo === '::after') {
                    top = 5;
                    left = -5;
                    width += 10;
                    height += 40;
                }
            }


            // 计算伪元素在视口中的绝对坐标
            // 注意：这取决于伪元素的 position（如果是 absolute/fixed）
            const pseudoTop = rect.top + (isNaN(top) ? 0 : top);
            const pseudoLeft = rect.left + (isNaN(left) ? 0 : left);

            // 判断鼠标是否在伪元素矩形内
            if (
                this.mousePos.x >= pseudoLeft &&
                this.mousePos.x <= pseudoLeft + width &&
                this.mousePos.y >= pseudoTop &&
                this.mousePos.y <= pseudoTop + height
            ) {
                return pseudo; // 返回点击到了哪个伪元素
            }
        }

        return null; // 没点到伪元素，返回宿主本身
    }

    private onMouseMove = (e: MouseEvent) => {
        if(this.frozen) return;
        this.mouseEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
        this.mousePos = { x: e.clientX, y: e.clientY };
        this.pseudo = this.getMousePseudoTarget();
    }

    private update = () => {
        // 如果没有类名，或者类名没变，则不重复计算

        if (!this.mouseEl || this.mouseEl?.classList.contains('highlight-overlay')) return;

        if (this.mouseEl === null) {
            this.selector = '';
            this.clearOverlays();
            return;
        }

        if(!this.mouseEl.className) {
            let selector = this.mouseEl.tagName.toLowerCase();

            let el: HTMLElement | null | undefined = this.mouseEl;
            while(!el?.className) {
                el = el?.parentElement;
            }
            if(el?.className) {
                this.selector = "." + el.className.trim().split(/\s+/).join('.') + " " + selector;
            }
            else {
                this.selector = selector;
            }
        }

        else{
            this.selector = "." + this.mouseEl?.className.trim().split(/\s+/).join('.');
        }

        if(this.pseudo) {
            this.selector += this.pseudo;
        }
        // this.lastClassName = this.mouseEl.className;
        this.clearOverlays();

        // 构造合法的 CSS 选择器（处理多类名情况，如 "nav-folder is-collapsed" -> ".nav-folder.is-collapsed"）
        try {
            let tmpSelector = this.selector;
            if(this.selector.includes('::')) {
                // 如果选择器包含伪元素，先去掉伪元素部分，找到所有匹配的宿主元素，再为每个宿主元素创建覆盖层
                tmpSelector = this.selector.split('::')[0]!; // 先去掉伪元素部分
            }
            const sameElements = document.querySelectorAll(tmpSelector); // 先用不带伪元素的选择器找出所有同类元素
            sameElements.forEach(target => {
                this.createOverlayFor(target as HTMLElement);
            });
        }        catch (err) {
            console.error('生成选择器失败:', err);
        }
    };

    private createOverlayFor(target: HTMLElement) {

        let rect = target.getBoundingClientRect() as { top: number, left: number, width: number, height: number};
        if(this.pseudo) {
            // 如果是伪元素，计算它相对于宿主元素的偏移
            const style = window.getComputedStyle(target, this.pseudo);
            const top = parseFloat(style.top) || 0;
            const left = parseFloat(style.left) || 0;
            const width = parseFloat(style.width) || rect.width;
            const height = parseFloat(style.height) || rect.height;
            if(isNaN(top) && isNaN(left)) {
                // 如果 top 和 left 都是 auto 或无法解析，说明伪元素可能是相对于宿主元素的默认位置（如 ::before 在内容前，::after 在内容后）
                if(this.pseudo === '::before') {
                    rect = {
                        top: rect.top + 5,
                        left: rect.left - 5,
                        width: width + 10,
                        height: height + 40
                    };
                }
                else if(this.pseudo === '::after') {
                    rect = {
                        top: rect.top + 5,
                        left: rect.left - 5,
                        width: width + 10,
                        height: height + 40
                    };
                }
            }
            else {
                rect = {
                    top: rect.top + top-5,
                    left: rect.left + left-5,
                    width: width+10,
                    height: height+50
                };
            }
        }
        const overlay = document.createElement('div');
        overlay.className = 'highlight-overlay'; // 标记，防止自触发
        
        Object.assign(overlay.style, {
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: '39',
            backgroundColor: 'rgba(0, 120, 215, 0.15)', // 稍淡一点，因为数量多
            border: '1px solid #0078d7',
            borderRadius: '5px',
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            top: `${rect.top}px`,
            left: `${rect.left}px`
        });

        document.body.appendChild(overlay);
        this.overlays.push(overlay);
    }

    private clearOverlays() {
        this.overlays.forEach(ov => ov.remove());
        this.overlays = [];
    }

    private onClick = (e: MouseEvent) => {
        if(this.frozen) return; // 如果已经冻结，说明编辑器弹窗已打开，不再响应点击事件
        this.toggleOverlays(false); // 关闭覆盖层显示，避免干扰编辑器操作
        e.preventDefault();
        e.stopImmediatePropagation();

        if (!this.mouseEl) return;

        new CSSInspectorFloatingPanel(this.app, this.mouseEl, this, this.pugin).open().setPosition(e.clientX + 30, 100);
        this.frozen = true; // 冻结状态，防止后续鼠标移动干扰选择
    };

    private destroy() {
        document.removeEventListener('mousemove', this.onMouseMove, true);
        document.removeEventListener('click', this.onClick, true);
        if (this.updateInterval) {
            window.clearInterval(this.updateInterval);
        }
        this.clearOverlays();
    }
}