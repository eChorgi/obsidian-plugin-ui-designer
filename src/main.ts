import { App, Plugin, Notice, Modal, Setting } from 'obsidian';

export default class ElementSelectorPlugin extends Plugin {
    async onload() {
        this.addRibbonIcon('target', '选择ui元素进行修改', () => {
            new MultiSelectorInstance(this.app);
        });

        this.addCommand({
            id: 'start-multi-element-selector',
            name: '选择ui元素进行修改',
            callback: () => new MultiSelectorInstance(this.app)
        });
    }
}

class AttributeEditItem {
    constructor(
        public name: string,
        public prop: string,
        public type: 'slider' | 'color' | 'font' | 'text' | 'select' | 'image-upload',
        public options: { min?: number; max?: number; step?: number; unit?: string; options?: string[]; optionsDisplay?: string[] } | undefined,
        private subs: any[] = [],
        public on: string | undefined = undefined,
        public also: string | undefined = undefined, // 关联属性（如 color 关联 -webkit-text-fill-color）
        public role: string | undefined = undefined, // 角色（如 'shorthand', 'part-x') 用于拼接属性值
        public previewEl: HTMLElement,
        public body: HTMLElement,
        public computedStyle: CSSStyleDeclaration
    ) {
        this.subItems = []
        subs.forEach(sub => {
            console.log('Initializing sub-item:', sub);
            this.subItems.push(new AttributeEditItem(
                sub.name,
                sub.prop,
                sub.type,
                { min: sub?.min, max: sub?.max, step: sub?.step, unit: sub?.unit, options: sub?.options, optionsDisplay: sub?.optionsDisplay },
                sub.subs,
                sub.on,
                sub.also,
                sub.role,
                this.previewEl,
                this.body,
                this.computedStyle
            ));
            console.log('Created sub-item:', this.subItems[this.subItems.length - 1]);
        });
    }
    public subItems: AttributeEditItem[] = [];
    public setting!: Setting;
    public valueDisplay!: HTMLElement;
    public controlEl!: HTMLElement;
    public currentValue!: string;
    public parentItem?: AttributeEditItem;
    public subContainer!: HTMLDivElement; // 用于存放子属性的容器


    private rgbToHex(rgb: string): string {
        // 匹配数字，如果没有匹配到，result 将会是 null
        const result = rgb.match(/\d+/g);
        
        // 如果 result 为空，或者匹配到的数字少于 3 个，直接返回默认颜色
        if (!result || result.length < 3) {
            return '#ffffff'; 
        }
        
        // 此时 TypeScript 知道 result 一定不是 null，可以安全解析
        const r = parseInt(result[0]!);
        const g = parseInt(result[1]!);
        const b = parseInt(result[2]!);
        
        // 使用位运算转换为 Hex
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    private async loadSystemFonts(selectEl: HTMLSelectElement) {
        // @ts-ignore - 忽略 window 类型错误
        if (!('queryLocalFonts' in window)) {
            throw new Error('API not supported');
        }

        try {
            // @ts-ignore
            const fonts = await window.queryLocalFonts();
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

    public reset() {
        this.previewEl.style.setProperty(this.prop, this.currentValue, 'important');
        if (this.also) {
            this.previewEl.style.setProperty(this.also, this.currentValue, 'important');
        }
        if(this.subItems.length > 0) {
            // 递归重置子属性
            this.subItems.forEach(item => {
                item.reset();
            });
        }
    }


    public createElement() {
        this.setting = new Setting(this.body).setName(this.name);
        this.currentValue = this.computedStyle.getPropertyValue(this.prop).trim();
        if (this.type === 'slider') {
            const numericValue = parseFloat(this.currentValue) || 0;
            
            // 数值显示以及点击可编辑
            // const valueDisplay = this.setting.controlEl.createEl('span', {
            //     text: `${numericValue}${this.options?.unit ?? ''}`
            // });

            const displayStack = this.setting.controlEl.createDiv({ cls: 'value-display-stack' });
            Object.assign(displayStack.style, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'end',
                width: '70px',
                height: '16px',
            });
            const valueDisplay = displayStack.createEl('span', {
                text: `${numericValue}${this.options?.unit ?? ''}`,
                cls: 'value-display-label' // 建议加个类名方便写 CSS
            });
            const valueInput = displayStack.createEl('input', {
                type: 'number',
                value: `${numericValue}${this.options?.unit ?? ''}`,
                cls: 'value-display-input' // 建议加个类名方便写 CSS
            });

            // 让它看起来可以点击（鼠标手势）
            valueDisplay.style.cursor = 'pointer';

            valueDisplay.addEventListener('click', () => {

                valueInput.style.display = 'inline';
                valueDisplay.style.display = 'none';
                valueInput.value = `${parseFloat(valueDisplay.textContent!) || 0}`;
                // console.log('Entering edit mode with value:', valueInput.value);
                valueInput.focus();
                

                
                // 2. 隐藏原本的 span
                valueDisplay.style.display = 'none';
                valueInput.focus();

                // 3. 定义同步样式的函数
                const confirmEdit = () => {
                    console.log('Confirmed new value:', valueInput.value);
                    valueDisplay.style.display = 'inline';
                    const newValue = parseFloat(valueInput.value);
                    if (!isNaN(newValue)) {
                        // 更新显示文本
                        valueDisplay.innerText = `${newValue}${this.options?.unit ?? ''}`;

                        this.previewEl.style.setProperty(this.prop, `${newValue}${this.options?.unit ?? ''}`, 'important');
                        if (this.also) {
                            this.previewEl.style.setProperty(this.also, `${newValue}${this.options?.unit ?? ''}`, 'important');
                        }
                        valueDisplay.textContent = `${newValue}${this.options?.unit ?? ''}`;
                        // 更新 slider 的位置（如果有的话）
                        const slider = this.setting.controlEl.querySelector('input[type="range"]') as HTMLInputElement;
                        if (slider) {
                            slider.value = String(newValue);
                        }

                    }
                    valueInput.style.display = 'none';
                };

                // 4. 绑定退出编辑的事件
                valueInput.addEventListener('blur', confirmEdit);
                valueInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') confirmEdit();
                    if (e.key === 'Escape') { // 取消编辑
                        valueInput.style.display = 'none';
                        valueDisplay.style.display = 'inline';
                    }
                });
            });
            
            Object.assign(valueDisplay.style, {
                border: 'none',
                maxWidth: '50px',
                maxHeight: '17px',
                padding: '0',
                fontSize: 'var(--font-smaller)',
                color: 'var(--text-muted)'
            });
            //向左偏移30px，给后面的 slider 留出空间
            Object.assign(valueInput.style, {
                display: 'none',
                border: 'none',
                maxWidth: '50px',
                maxHeight: '17px',
                padding: '0',
                textAlign: 'right',
                fontSize: 'var(--font-smaller)',
                color: 'var(--text-muted)',
            });

            // 创建原生的 input range
            const slider = this.setting.controlEl.createEl('input', {
                type: 'range',
                attr: {
                    min: String(this.options?.min ?? 0),
                    max: String(this.options?.max ?? 100),
                    step: String(this.options?.step ?? 1),
                    value: String(numericValue)
                }
            });
            
            
            
            // 实时更新样式
            slider.addEventListener('input', (e) => {
                const value = parseFloat(slider.value);
                const finalValue = `${value}${this.options?.unit ?? ''}`;
                
                this.previewEl.style.setProperty(this.prop, finalValue, 'important');
                if (this.also) {
                    this.previewEl.style.setProperty(this.also, finalValue, 'important');
                }
                valueDisplay.textContent = finalValue;
                
            });
            
            // 重置按钮
            this.setting.addExtraButton(btn => btn
                .setIcon('reset')
                .setTooltip('重置')
                .onClick(() => {
                    this.previewEl.style.setProperty(this.prop, this.currentValue, 'important');
                    if (this.also) {
                        this.previewEl.style.setProperty(this.also, this.currentValue, 'important');
                    }
                    slider.value = String(numericValue);
                    valueDisplay.textContent = this.currentValue;
                })
            );
        }
        else if (this.type === 'color') {
            // 1. 定义一个变量来存储组件实例
            let colorComponent: any; 

            this.setting.addColorPicker(color => {
                colorComponent = color; // 将实例赋值给变量
                color
                    .setValue(this.rgbToHex(this.currentValue))
                    .onChange(value => {
                        this.previewEl.style.setProperty(this.prop, value, 'important');
                        if (this.also) {
                            this.previewEl.style.setProperty(this.also, value, 'important');
                        }
                    
                    });
            });
            // 清空按钮
            this.setting.addExtraButton(btn => btn
                .setIcon('cross')
                .setTooltip('清空')
                .onClick(() => {
                    //指示器调为黑色
                    if (colorComponent) {
                        colorComponent.setValue('#00000000');
                    }
                    this.previewEl.style.setProperty(this.prop, '', 'important');
                    if (this.also) {
                        this.previewEl.style.setProperty(this.also, '', 'important');
                    }
                })
            );
            this.setting.addExtraButton(btn => btn
                .setIcon('reset')
                .setTooltip('重置')
                .onClick(() => {
                    // 应用原始样式
                    this.reset();

                    // 2. 现在可以安全地访问 colorComponent 了
                    if (colorComponent) {
                        colorComponent.setValue(this.rgbToHex(this.currentValue));
                    }
                    
                    // new Notice(`已重置 ${this.name}`);
                })
            );
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
                this.previewEl.style.fontFamily = fontFamily;
                // 这里可以保存配置
            });

        }
        else if (this.type === 'select') {
            const selectEl = this.setting.controlEl.createEl('select');
            this.options?.options?.forEach((opt, idx) => {
                const option = selectEl.createEl('option');
                option.value = opt;
                option.textContent = (this.options?.optionsDisplay ? this.options.optionsDisplay[idx] : opt)??null;
            });
            selectEl.value = this.currentValue;
            selectEl.addEventListener('change', () => {
                this.previewEl.style.setProperty(this.prop, selectEl.value, 'important');
                if (this.also) {
                    this.previewEl.style.setProperty(this.also, selectEl.value, 'important');
                }
            });
        }
        else if (this.type === 'text') {
            const inputEl = this.setting.controlEl.createEl('input', { type: 'text' });
            inputEl.value = this.currentValue;
            inputEl.addEventListener(this.on ?? 'input', () => {
                this.previewEl.style.setProperty(this.prop, inputEl.value, 'important');
                if (this.also) {
                    this.previewEl.style.setProperty(this.also, inputEl.value, 'important');
                }
            });
        }
        else if (this.type === 'image-upload') {
            const fileInput = this.setting.controlEl.createEl('input', { type: 'file', cls: 'ui-designer-image-upload-input' }) as HTMLInputElement;
            fileInput.accept = 'image/*';


            fileInput.addEventListener('change', async () => {
                    
                const file = fileInput.files?.[0];
                if (!file) return;

                // 设置css 属性
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result as string;
                    this.previewEl.style.setProperty(this.prop, `url(${result})`, 'important');
                    if (this.also) {
                        this.previewEl.style.setProperty(this.also, `url(${result})`, 'important');
                    }
                    // 存储Base64字符串到插件设置中，以便后续使用
                    // this.plugin.settings.backgroundImage = result;
                };
                // 根据需求选择读取方式：readAsText 或 readAsDataURL (用于图片)
                reader.readAsDataURL(file); 
            });
        }

        if(this.subItems.length > 0) {
            //创建一个可以展开/收起的子属性容器
            this.subContainer = this.body.createDiv({ cls: 'sub-attribute-container' });
            Object.assign(this.subContainer.style, {
                marginLeft: '20px',
                borderLeft: '1px dashed var(--background-modifier-border)',
                paddingLeft: '10px',
                // 丝滑核心：
                overflow: 'hidden',
                transition: 'max-height 0.3s ease-out, opacity 0.3s ease-out',
                maxHeight: '0px', // 默认收起
                opacity: '0',     // 配合透明度更高级
            });
            //处理展开收起逻辑
            const toggleButton = this.setting.addExtraButton(btn => btn
                .setIcon('chevron-right')
                .setTooltip('展开子属性')
                .onClick(() => {
                    // 判断当前是否是收起状态（以 0px 为准）
                    const isCollapsed = this.subContainer.style.maxHeight === '0px';

                    if (isCollapsed) {
                        // 展开：设置为一个足够大的值（或者 scrollHeight）
                        // scrollHeight 可以动态获取内容的真实高度，最丝滑
                        const el = this.subContainer;
                        el.style.opacity = '1';
                        el.style.maxHeight = el.scrollHeight + 'px';

                        // 2. 核心：监听动画结束
                        el.addEventListener('transitionend', function handler() {
                            if (el.style.maxHeight !== '0px') {
                                el.style.maxHeight = 'none'; 
                            }
                            el.removeEventListener('transitionend', handler);
                        }, { once: true });
                    } else {
                        // 收起
                        this.subContainer.style.maxHeight = '0px';
                        this.subContainer.style.opacity = '0';
                        btn.setIcon('chevron-right');
                        btn.setTooltip('展开子属性');
                    }
                })
            );


            //递归创建子属性
            this.subItems.forEach(subItem => {
                subItem.previewEl = this.previewEl;
                subItem.body = this.subContainer;
                subItem.computedStyle = this.computedStyle;
                subItem.parentItem = this;
                console.log('Creating sub-item:', subItem);
                
                subItem.createElement();
            });

        }
    }
}

// 1. 不再继承 Modal，因为它会自带遮罩和居中逻辑
class CSSInspectorFloatingPanel {
    private previewEl!: HTMLElement;
    private isDragging = false;
    private offset = { x: 0, y: 0 };
    private el!: HTMLDivElement;

    constructor(private app: App, private targetEl: HTMLElement) {
        this.initUI();
    }

    public open() {
        // 已经在 initUI 中创建并添加到 DOM，无需重复操作
        return this; // 方便链式调用
    }
        
    
    private initUI() {
        // 创建主面板
        this.el = document.createElement('div');
        this.el.addClass('obsidian-floating-panel');

        Object.assign(this.el.style, {
            position: 'fixed',
            top: '100px',
            right: '100px',
            width: '500px',
            zIndex: '10000',
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
        const handle = this.el.createDiv({ cls: 'drag-handle' });
        handle.textContent = '⋮ UI 样式修改器';
        Object.assign(handle.style, {
            padding: '10px',
            cursor: 'grab',
            backgroundColor: 'var(--background-secondary)',
            borderBottom: '1px solid var(--background-modifier-border)',
            userSelect: 'none'
        });

        // 拖拽逻辑 (使用箭头函数自动绑定 this)
        handle.onmousedown = (e) => {
            this.isDragging = true;
            this.offset.x = e.clientX - this.el.offsetLeft;
            this.offset.y = e.clientY - this.el.offsetTop;
            handle.style.cursor = 'grabbing';
            
            // 增加全局监听，防止鼠标滑出面板后断开
            const onMouseMove = (e: MouseEvent) => {
                if (!this.isDragging) return;
                this.el.style.left = `${e.clientX - this.offset.x}px`;
                this.el.style.top = `${e.clientY - this.offset.y}px`;
            };

            const onMouseUp = () => {
                this.isDragging = false;
                handle.style.cursor = 'grab';
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
        
        Object.assign(previewContainer.style, {
            width: '100%',
            height: '100%',
            padding: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--background-secondary)',
            borderBottomLeftRadius: '8px',
            borderBottomRightRadius: '8px',
            borderBottom: '1px inset var(--background-modifier-border)',
            marginBottom: '0',
            overflow: 'auto',
        });

        const target_style = window.getComputedStyle(this.targetEl);

        this.previewEl = this.targetEl.cloneNode(true) as HTMLElement;
        
        console.log('Computed styles of target element:', target_style);
        for (const key of target_style) {
            this.previewEl.style.setProperty(
                key, 
                target_style.getPropertyValue(key), 
                target_style.getPropertyPriority(key) 
            );
            console.log(`Applied style: ${key}: ${target_style.getPropertyValue(key)};`);
        }
        previewContainer.appendChild(this.previewEl);
        // --- 属性编辑区 ---5DCAF-8C298-60784-72AB2
        // 注意：如果你在非 Modal 类里使用 Setting，需要传入 HTMLElement
        const props = [
            { name: '背景颜色', prop: 'background-color', type: 'color',
                subs: [
                    { name: '背景图片', prop: 'background-image', type: 'image-upload' },
                    { name: '平铺方式', prop: 'background-repeat', type: 'select', options: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'], optionsDisplay: ['不平铺', '平铺', '横向平铺', '纵向平铺'] },
                    { name: '缩放方式', prop: 'background-size', type: 'select', options: ['auto', 'cover', 'contain'], optionsDisplay: ['原始', '优先铺满容器', '优先展示全图'] },
                    { name: '对齐位置', prop: 'background-position', type: 'select', options: ['center', 'top', 'bottom', 'left', 'right'], optionsDisplay: ['居中', '靠顶', '靠底', '靠左', '靠右'] },
                    { name: '背景透明度', prop: 'background-opacity', type: 'slider', min: 0, max: 1, step: 0.1, unit: '' },
                    { name: '背景混合模式', prop: 'background-blend-mode', type: 'select',options: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'],optionsDisplay: ['正常', '正片叠底', '滤色', '叠加', '变暗', '变亮']}
                ]
            },
            { name: '颜色', prop: 'color', type: 'color', also: '-webkit-text-fill-color' },
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
            { name: '透明度', prop: 'opacity', type: 'slider', min: 0, max: 1, step: 0.1, unit: '' },
            { name: '字体', prop: 'font-family', type: 'font' ,
                subs: [
                    { name: '字体大小', prop: 'font-size', type: 'slider', min: 10, max: 36, unit: 'px' },
                    { name: '字体颜色', prop: 'color', type: 'color', also: '-webkit-text-fill-color'},
                    { name: '字体样式', prop: 'font-style', type: 'select', options: ['normal', 'italic', 'oblique'], optionsDisplay: ['正常', '斜体', '强制倾斜'] },
                    { name: '字体粗细', prop: 'font-weight', type: 'select', options: ['normal', 'bold', 'bolder', 'lighter'], optionsDisplay: ['正常', '加粗', '超粗', '细'] },
                    { name: '行高', prop: 'line-height', type: 'slider', min: 1, max: 3, step: 0.1, unit: '' },
                    { name: '字间距', prop: 'letter-spacing', type: 'slider', min: -5, max: 20, unit: 'px' },
                    { name: '文字对齐', prop: 'text-align', type: 'select', options: ['left', 'right', 'center', 'justify'], optionsDisplay: ['左对齐', '右对齐', '居中对齐', '两端对齐'] },
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
                    { name: '文本溢出', prop: 'text-overflow', type: 'select',options: ['clip', 'ellipsis'],optionsDisplay: ['裁剪', '省略号']},
                    { name: '文本阴影', prop: 'text-shadow', type: 'text',
                        subs: [
                            { name: '水平偏移', prop: 'text-shadow-offset-x', type: 'slider', min: -20, max: 20, unit: 'px' },
                            { name: '垂直偏移', prop: 'text-shadow-offset-y', type: 'slider', min: -20, max: 20, unit: 'px' },
                            { name: '模糊半径', prop: 'text-shadow-blur-radius', type: 'slider', min: 0, max: 20, unit: 'px' },
                            { name: '阴影颜色', prop: 'text-shadow-color', type: 'color' },
                        ]
                    }
                ]
            },
            { name: '定位', prop: 'position', type: 'select', 
                options: ['static', 'relative', 'absolute', 'fixed', 'sticky'], 
                optionsDisplay: ['默认', '相对定位', '绝对定位', '固定定位', '粘性定位'],
                subs: [
                    { name: '层级', prop: 'z-index', type: 'slider', min: 0, max: 9999, unit: '' },
                    { name: '上偏移', prop: 'top', type: 'slider', min: -500, max: 500, unit: 'px' },
                    { name: '下偏移', prop: 'bottom', type: 'slider', min: -500, max: 500, unit: 'px' },
                    { name: '左偏移', prop: 'left', type: 'slider', min: -500, max: 500, unit: 'px' },
                    { name: '右偏移', prop: 'right', type: 'slider', min: -500, max: 500, unit: 'px' }
                ]
            },
            
            { name: '布局', prop: 'display', type: 'select', options: ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid'], optionsDisplay: ['块级', '行内块', '行内', '弹性布局', '行内弹性布局', '网格布局', '行内网格布局'],
                subs: [
                    { name: '弹性方向', prop: 'flex-direction', type: 'select', options: ['row', 'row-reverse', 'column', 'column-reverse'], optionsDisplay: ['横向', '横向反序', '纵向', '纵向反序'] },
                    { name: '主轴对齐方式', prop: 'justify-content', type: 'select', options: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around'], optionsDisplay: ['起点对齐', '终点对齐', '居中', '两端对齐', '环绕对齐'] },
                    { name: '交叉轴对齐方式', prop: 'align-items', type: 'select', options: ['stretch', 'flex-start', 'flex-end', 'center'], optionsDisplay: ['拉伸填满', '起点对齐', '终点对齐', '居中'] },
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
            {
                name: '尺寸', prop: '', type: 'none',
                subs: [
                    { name: '宽度', prop: 'width', type: 'slider', min: 0, max: 1000, unit: 'px' },
                    { name: '高度', prop: 'height', type: 'slider', min: 0, max: 1000, unit: 'px' },
                    { name: '最小宽度', prop: 'min-width', type: 'slider', min: 0, max: 1000, unit: 'px' },
                    { name: '最小高度', prop: 'min-height', type: 'slider', min: 0, max: 1000, unit: 'px' },
                    { name: '最大宽度', prop: 'max-width', type: 'slider', min: 0, max: 1000, unit: 'px' },
                    { name: '最大高度', prop: 'max-height', type: 'slider', min: 0, max: 1000, unit: 'px' }
                ]
            },
            { name: '滤镜&特效', prop: '', type: 'none',
                subs: [
                    { name: '阴影', role:'shorthand', prop: 'box-shadow', type: 'text',
                        subs: [
                            { name: '水平偏移', role:'part-1', method: '', type: 'slider', min: -20, max: 20, unit: 'px'},
                            { name: '垂直偏移', role:'part-2', method: '', type: 'slider', min: -20, max: 20, unit: 'px'},
                            { name: '模糊半径', role:'part-3', method: '', type: 'slider', min: 0, max: 20, unit: 'px'},
                            { name: '阴影颜色', role:'part-4', method: '', type: 'color'},
                        ]
                    },
                    { name: '前景', role:'shorthand', prop: 'filter', type: 'text' ,
                        subs: [
                            { name: '模糊',role:'part-1', method: 'blur', type: 'slider', min: 0, max: 20, unit: 'px' },
                            { name: '亮度',role:'part-2', method: 'brightness', type: 'slider', min: 0, max: 200, unit: '%' },
                            { name: '对比度',role:'part-3', method: 'contrast', type: 'slider', min: 0, max: 200, unit: '%' },
                            { name: '灰度',role:'part-4', method: 'grayscale', type: 'slider', min: 0, max: 100, unit: '%' },
                            { name: '反转',role:'part-5', method: 'invert', type: 'slider', min: 0, max: 100, unit: '%' },
                            { name: '饱和度',role:'part-6', method: 'saturate', type: 'slider', min: 0, max: 200, unit: '%' },
                        ]
                    },
                    { name: '背景', role:'shorthand', prop: 'backdrop-filter', type: 'text' ,
                        subs: [
                            { name: '模糊',role:'part-1', method: 'blur', type: 'slider', min: 0, max: 20, unit: 'px' },
                            { name: '亮度',role:'part-2', method: 'brightness', type: 'slider', min: 0, max: 200, unit: '%' },
                            { name: '对比度',role:'part-3', method: 'contrast', type: 'slider', min: 0, max: 200, unit: '%' },
                            { name: '灰度',role:'part-4', method: 'grayscale', type: 'slider', min: 0, max: 100, unit: '%' },
                            { name: '反转',role:'part-5', method: 'invert', type: 'slider', min: 0, max: 100, unit: '%' },
                            { name: '饱和度',role:'part-6', method: 'saturate', type: 'slider', min: 0, max: 200, unit: '%' },
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
        ];
        const attributeEditors = props.map((p: any) => new AttributeEditItem(
            p.name, 
            p.prop, 
            p.type as 'slider' | 'color' | 'font' | 'text' | 'select' | 'image-upload', 
            { min: p.min, max: p.max, step: p.step, unit: p.unit, options: p.options, optionsDisplay: p.optionsDisplay }, 
            p.subs as any[],
            p.on,
            p.also,
            p.role,
            this.previewEl, 
            bottomColumn,
            target_style
        ));
        
        attributeEditors.forEach(editor => editor.createElement());

        
        
        // 5. 底部操作栏
        new Setting(this.el)
        .addButton(btn => btn
        .setButtonText('应用到原元素')
        .setWarning()
        .onClick(() => {
            // 创建或获取样式标签
            let styleEl = document.getElementById('obsidian-custom-override') as HTMLStyleElement;
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'obsidian-custom-override';
                document.head.appendChild(styleEl);
            }
            
            // 获取选择器
            const selector = "." + this.targetEl.className.trim().split(/\s+/).join('.');
            
            // 获取所有当前应用的样式
            let cssText = '';
            for (let i = 0; i < this.previewEl.style.length; i++) {
                const prop = this.previewEl.style[i] as string;
                const val = this.previewEl.style.getPropertyValue(prop);
                if (val) {
                    cssText += `${prop}: ${val} !important;\n`;
                }
            }
            
            // 注入样式
            styleEl.textContent = `${selector}${selector} {\n${cssText}\n}`;
            
            new Notice('样式已应用（通过CSS注入）');
        }))

        .addButton(btn => btn
        .setButtonText('仅复制 CSS')
        .onClick(() => {
            const css = this.previewEl.getAttribute('style') || '';
            navigator.clipboard.writeText(css.replace(/[\r\n]+/g, ' ').trim());
            new Notice('CSS 代码已复制');
        }));

        // --- 关闭按钮 ---
        const closeBtn = handle.createEl('span', { text: '×' });
        Object.assign(closeBtn.style, { float: 'right', cursor: 'pointer' });
        closeBtn.onclick = () => this.destroy();

        document.body.appendChild(this.el);
    }

    public setPosition(x: number, y: number) {
        //检测是否出界面右侧和底部，如果出界则置于另一边
        const panelRect = this.el.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let final_x = x + 50;
        let final_y = 100;
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
    }
}

class MultiSelectorInstance {
    private overlays: HTMLDivElement[] = [];
    private lastClassName: string = "";

    constructor(private app: App) {
        this.setupListeners();
    }

    private setupListeners() {
        document.addEventListener('mousemove', this.onMouseMove, true);
        document.addEventListener('click', this.onClick, true);
    }

    private onMouseMove = (e: MouseEvent) => {
        const el = e.target as HTMLElement;
        // 如果没有类名，或者类名没变，则不重复计算
        if (!el.className || el.classList.contains('highlight-overlay')) return;
        
        this.lastClassName = el.className;
        this.clearOverlays();

        // 构造合法的 CSS 选择器（处理多类名情况，如 "nav-folder is-collapsed" -> ".nav-folder.is-collapsed"）
        const selector = "." + el.className.trim().split(/\s+/).join('.');
        
        try {
            const sameElements = document.querySelectorAll(selector);
            sameElements.forEach(target => {
                this.createOverlayFor(target as HTMLElement);
            });
        } catch (err) {
            // 防止某些特殊类名导致 querySelector 报错
        }
    };

    private createOverlayFor(target: HTMLElement) {
        const rect = target.getBoundingClientRect();
        const overlay = document.createElement('div');
        overlay.className = 'highlight-overlay'; // 标记，防止自触发
        
        Object.assign(overlay.style, {
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: '9999',
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
        e.preventDefault();
        e.stopPropagation();

        const el = e.target as HTMLElement;
        const selector = "." + el.className.trim().split(/\s+/).join('.');
        
        navigator.clipboard.writeText(selector);
        new Notice(`已复制选择器: ${selector}`);

        // 打开编辑器弹窗，并将当前点击的元素传入
        const panel = new CSSInspectorFloatingPanel(this.app, el).open().setPosition(e.clientX + 30, 100);

        this.destroy();
    };

    private destroy() {
        document.removeEventListener('mousemove', this.onMouseMove, true);
        document.removeEventListener('click', this.onClick, true);
        this.clearOverlays();
    }
}