```javascript
// ==UserScript==
// @name         SLAX VIP V14 - Ultimate OCR & Translation
// @namespace    https://viayoo.com/
// @version      14.0
// @description  نظام تبييض غيمات الويب تون التلقائي وتحويل نصوص الصور إلى نصوص حقيقية قابلة للترجمة بمترجم جوجل دون أي توكنات!
// @author       Slax
// @run-at       document-start
// @match        *://*.webtoons.com/*
// @match        *://*/*
// @connect      *
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // حقن مكتبة Tesseract.js للتعرف الضوئي على النصوص بدون سيرفر خارجي
    const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    let isOcrRunning = false;
    let autoTranslateActive = false;
    let ocrLanguage = localStorage.getItem('slax_ocr_lang') || 'eng'; // اللغة الافتراضية للنصوص بالصورة

    // تحميل المكتبة ديناميكياً
    function loadTesseract() {
        return new Promise((resolve, reject) => {
            if (window.Tesseract) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = TESSERACT_CDN;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("فشل تحميل مكتبة الـ OCR. يرجى التحقق من اتصال الإنترنت."));
            document.head.appendChild(script);
        });
    }

    // جلب بيانات الصورة متجاوزاً حماية السيرفرات (Referer Spoofing)
    async function getImageBlob(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                responseType: "blob",
                headers: { "Referer": location.origin },
                onload: (res) => resolve(res.response),
                onerror: () => reject()
            });
        });
    }

    // إظهار إشعارات داخل الواجهة بدلاً من الـ alert
    function showNotification(msg, type = "info") {
        const notif = document.createElement('div');
        notif.style = `position:fixed; bottom:20px; right:20px; background:#111; color:${type === 'error' ? '#ff4d4d' : '#00ffcc'}; border:1px solid ${type === 'error' ? '#ff4d4d' : '#00ffcc'}; padding:12px 24px; border-radius:10px; z-index:2147483647; font-family:sans-serif; font-size:12px; box-shadow:0 5px 15px rgba(0,0,0,0.5); direction:rtl; transition: all 0.3s ease;`;
        notif.innerText = msg;
        document.body.appendChild(notif);
        setTimeout(() => {
            notif.style.opacity = '0';
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    }

    // المعالجة الذكية لتبييض الغيمات ووضع النصوص الحقيقية
    async function processImageForOcr(img) {
        if (img.dataset.ocrProcessed) return;
        img.dataset.ocrProcessed = "processing";

        try {
            // تحضير الـ Canvas ومطابقته للصورة الأصلية
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // جلب الصورة كـ Blob لتجنب حماية CORS
            const blob = await getImageBlob(img.src);
            const blobUrl = URL.createObjectURL(blob);
            
            const tempImg = new Image();
            tempImg.crossOrigin = "anonymous";
            await new Promise((res, rej) => {
                tempImg.onload = res;
                tempImg.onerror = rej;
                tempImg.src = blobUrl;
            });

            canvas.width = tempImg.naturalWidth;
            canvas.height = tempImg.naturalHeight;
            ctx.drawImage(tempImg, 0, 0);

            // تشغيل الـ OCR محلياً على المتصفح
            const worker = await Tesseract.createWorker(ocrLanguage);
            const ret = await worker.recognize(canvas);
            const paragraphs = ret.data.paragraphs;
            await worker.terminate();

            if (paragraphs && paragraphs.length > 0) {
                // إنشاء حاوية لتغطية الصورة ووضع النصوص
                const wrapper = document.createElement('div');
                wrapper.className = "slax-ocr-wrapper";
                wrapper.style = `position: relative; display: inline-block; width: ${img.clientWidth}px; height: ${img.clientHeight}px;`;
                
                // استبدال الصورة الأصلية بالـ Wrapper
                img.parentNode.insertBefore(wrapper, img);
                wrapper.appendChild(img);

                // تجهيز ستايلات الصورة لتكون متجاوبة داخل الغلاف
                img.style.width = "100%";
                img.style.height = "auto";
                img.style.display = "block";

                // نسبة التحجيم بين الأبعاد الحقيقية وأبعاد العرض بالصفحة
                const scaleX = img.clientWidth / canvas.width;
                const scaleY = img.clientHeight / canvas.height;

                paragraphs.forEach(p => {
                    const bbox = p.bbox;
                    const text = p.text.trim();
                    if (!text || text.length < 2) return;

                    // 1. تبييض الغيمة في الكانفاس (مسح النص الأصلي)
                    // نقوم بأخذ عينة لونية من حافة الغيمة لتلوين الفراغ وجعله متناسقاً
                    const sampleX = Math.max(0, bbox.x0 - 5);
                    const sampleY = Math.max(0, bbox.y0 - 5);
                    const pixelData = ctx.getImageData(sampleX, sampleY, 1, 1).data;
                    const bgRgb = `rgb(${pixelData[0]}, ${pixelData[1]}, ${pixelData[2]})`;

                    // تلوين المساحة التي تحتوي على النص الأصلي
                    ctx.fillStyle = bgRgb;
                    ctx.fillRect(bbox.x0 - 4, bbox.y0 - 4, (bbox.x1 - bbox.x0) + 8, (bbox.y1 - bbox.y0) + 8);

                    // 2. تركيب نص حقيقي قابل للترجمة التلقائية
                    const textOverlay = document.createElement('div');
                    textOverlay.className = "slax-real-text translate-me"; // كلاس ليتم استهدافه بالترجمة
                    textOverlay.innerText = text;

                    // حساب الأبعاد بدقة متناهية متجاوبة مع الشاشات والهواتف
                    const left = bbox.x0 * scaleX;
                    const top = bbox.y0 * scaleY;
                    const width = (bbox.x1 - bbox.x0) * scaleX;
                    const height = (bbox.y1 - bbox.y0) * scaleY;

                    // نمط النص المترجم ليكون مريحاً ومطابقاً للقصص المصورة
                    textOverlay.style = `
                        position: absolute;
                        left: ${left}px;
                        top: ${top}px;
                        width: ${width}px;
                        height: ${height}px;
                        color: #000;
                        font-family: 'CCWildWords', 'Segoe UI', sans-serif;
                        font-weight: bold;
                        font-size: ${Math.max(10, height * 0.25)}px;
                        text-align: center;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        line-height: 1.2;
                        overflow: visible;
                        word-break: break-word;
                        pointer-events: auto;
                        z-index: 5;
                        text-shadow: 1px 1px 0px #fff, -1px -1px 0px #fff, 1px -1px 0px #fff, -1px 1px 0px #fff;
                    `;

                    wrapper.appendChild(textOverlay);
                });

                // تحديث الصورة بمصدر الصورة الخالي من النصوص (المبيض)
                img.src = canvas.toDataURL();
                img.dataset.ocrProcessed = "success";
            } else {
                img.dataset.ocrProcessed = "no-text";
            }
        } catch (err) {
            console.error("خطأ معالجة الصورة: ", err);
            img.dataset.ocrProcessed = "failed";
        }
    }

    // فحص دوري لتبييض كل المانجا بالصفحة
    async function startAutoOcrPipeline() {
        if (!autoTranslateActive) return;
        const imgs = Array.from(document.querySelectorAll('img:not([data-ocr-processed])')).filter(i => i.clientHeight > 200);
        
        if (imgs.length > 0) {
            const statusEl = document.getElementById('ai-status');
            if (statusEl) statusEl.innerText = `🔄 معالجة ${imgs.length} صفحات...`;
            
            for (const img of imgs) {
                if (!autoTranslateActive) break;
                await processImageForOcr(img);
            }
            if (statusEl) statusEl.innerText = "جاهز للعمل ✅";
        }
        setTimeout(startAutoOcrPipeline, 3000);
    }

    // بناء واجهة الأداة المتقدمة
    function createSlaxUI() {
        if (document.getElementById('slax-root')) return;

        const root = document.createElement('div');
        root.id = 'slax-root';
        root.style = `position:fixed; top:${localStorage.getItem('slax_y') || '100px'}; left:${localStorage.getItem('slax_x') || '10px'}; z-index:2147483647; direction:rtl; font-family: system-ui, -apple-system, sans-serif; user-select: none;`;
        document.body.appendChild(root);

        const sBtn = document.createElement('div');
        sBtn.style = `width:50px; height:50px; background:linear-gradient(135deg, #00f2fe, #4facfe); border:2px solid #fff; border-radius:50%; cursor:pointer; box-shadow:0 4px 15px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; transition: transform 0.2s;`;
        sBtn.innerHTML = `<img src="https://i.ibb.co/mCvjPHqz/image.png" style="width:100%; height:100%; border-radius:50%; pointer-events:none;">`;
        root.appendChild(sBtn);

        const menu = document.createElement('div');
        menu.style = `display:none; background:rgba(10,10,15,0.98); border:1px solid #00f2fe; padding:15px; border-radius:20px; width:300px; margin-top:10px; color:white; box-shadow:0 10px 30px rgba(0,0,0,0.6); backdrop-filter: blur(10px);`;
        
        menu.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <span style="color:#00f2fe; font-weight:bold; font-size:14px; letter-spacing: 0.5px;">👑 SLAX SMART OCR V14</span>
                <span id="ai-status" style="font-size:10px; color:#00ffcc; background: rgba(0,255,204,0.1); padding: 2px 8px; border-radius: 20px;">جاهز للعمل</span>
            </div>

            <!-- لوحة التحكم في مسح الحروف OCR والتبييض -->
            <div style="background:#161622; padding:12px; border-radius:15px; margin-bottom:10px; border:1px solid #252538;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-size:11px; color:#aaa;">لغة النص بالصورة:</span>
                    <select id="s-ocr-lang" style="background:#000; color:#fff; border:1px solid #333; padding:4px 8px; border-radius:6px; font-size:11px;">
                        <option value="eng">الإنجليزية (Default)</option>
                        <option value="kor">الكورية (Korean)</option>
                        <option value="jpn">اليابانية (Japanese)</option>
                        <option value="chi_sim">الصينية المبسطة</option>
                    </select>
                </div>
                <button id="s-auto-ocr" style="width:100%; background:linear-gradient(135deg, #111, #222); border:1px solid #00ffcc; padding:10px; border-radius:10px; color:#00ffcc; font-weight:bold; font-size:13px; cursor:pointer; transition:all 0.3s;">📝 تحويل غيمات الصور لنصوص (OFF)</button>
                <div style="font-size:9px; color:#888; text-align:center; margin-top:6px; line-height: 1.3;">قم بتفعيل هذا الخيار ثم استخدم ترجمة جوجل للمتصفح لترجمة النصوص الحقيقية تلقائياً!</div>
            </div>

            <div style="display:flex; gap:5px; margin-bottom:10px;">
                <button id="s-go-search" style="background:#00f2fe; border:none; width:40px; border-radius:10px; color:#000; cursor:pointer;">🔍</button>
                <input type="text" id="s-input" placeholder="بحث مانهوا.." style="flex:1; background:#000; color:#fff; border:1px solid #333; padding:8px; border-radius:10px; font-size:12px; outline:none;">
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; margin-bottom:10px;">
                 <button id="s-clean" style="background:rgba(0,242,254,0.1); border:1px solid #00f2fe; padding:8px; border-radius:10px; color:#00f2fe; font-size:11px; cursor:pointer;">🎬 تنظيف الإعلانات</button>
                 <button id="s-scroll" style="background:#222; border:1px solid #444; padding:8px; border-radius:10px; color:white; font-size:11px; cursor:pointer;">⏯ تمرير آلي</button>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1.5fr 1fr; gap:5px; margin-bottom:10px;">
                <button id="s-prev" style="background:#222; border:1px solid #333; padding:10px; border-radius:10px; font-size:11px; cursor:pointer;">السابق</button>
                <button id="s-jump" style="background:#00f2fe; border:none; border-radius:10px; color:#000; font-weight:bold; cursor:pointer;">انتقال</button>
                <button id="s-next" style="background:#222; border:1px solid #333; padding:10px; border-radius:10px; font-size:11px; cursor:pointer;">التالي</button>
            </div>

            <div style="background:rgba(0,0,0,0.4); padding:12px; border-radius:15px; border:1px solid #222;">
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#ffcc00;"><span>سرعة التمرير</span><span id="v-speed">2</span></div><input type="range" id="r-speed" min="1" max="50" value="2" style="width:100%;"></div>
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#00ffcc;"><span>التشبع %</span><span id="v-sat">100</span></div><input type="range" id="r-sat" min="50" max="250" value="100" style="width:100%;"></div>
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#00f2fe;"><span>الوضوح %</span><span id="v-con">100</span></div><input type="range" id="r-con" min="50" max="200" value="100" style="width:100%;"></div>
                <div><div style="display:flex; justify-content:space-between; font-size:10px; color:#ff4d4d;"><span>السطوع %</span><span id="v-bri">100</span></div><input type="range" id="r-bri" min="30" max="150" value="100" style="width:100%;"></div>
            </div>
        `;
        root.appendChild(menu);

        // تفاعلات المفاتيح والأزرار
        const ocrBtn = document.getElementById('s-auto-ocr');
        const langSelect = document.getElementById('s-ocr-lang');

        langSelect.onchange = function() {
            ocrLanguage = this.value;
            localStorage.setItem('slax_ocr_lang', ocrLanguage);
            showNotification(`تم تغيير لغة الفحص إلى: ${this.options[this.selectedIndex].text}`);
        };

        ocrBtn.onclick = async function() {
            if (isOcrRunning) return;
            isOcrRunning = true;
            this.innerText = "⏳ جاري تحميل المحرك...";

            try {
                await loadTesseract();
                autoTranslateActive = !autoTranslateActive;

                if (autoTranslateActive) {
                    this.style.background = "linear-gradient(135deg, #02b389, #00ffcc)";
                    this.style.color = "#000";
                    this.innerText = "📝 محرك النصوص نشط (ON)";
                    showNotification("تم تفعيل ميزة استخراج النصوص وتبييض الغيمات! افتح مترجم Google الآن لترجمة الصفحة تلقائياً.");
                    startAutoOcrPipeline();
                } else {
                    this.style.background = "linear-gradient(135deg, #111, #222)";
                    this.style.color = "#00ffcc";
                    this.innerText = "📝 تحويل غيمات الصور لنصوص (OFF)";
                    showNotification("تم إيقاف فحص النصوص.");
                }
            } catch (err) {
                showNotification(err.message, "error");
                this.style.background = "linear-gradient(135deg, #ff4d4d, #222)";
                this.innerText = "❌ خطأ في التحميل";
            } finally {
                isOcrRunning = false;
            }
        };

        // تغيير الفلاتر للصورة
        const updateFilters = () => {
            const s = document.getElementById('r-sat').value;
            const c = document.getElementById('r-con').value;
            const b = document.getElementById('r-bri').value;
            document.querySelectorAll('img').forEach(i => {
                if (!i.closest('#slax-root')) {
                    i.style.filter = `saturate(${s}%) contrast(${c}%) brightness(${b}%)`;
                }
            });
            document.getElementById('v-sat').innerText = s;
            document.getElementById('v-con').innerText = c;
            document.getElementById('v-bri').innerText = b;
        };
        ['r-sat', 'r-con', 'r-bri'].forEach(id => document.getElementById(id).oninput = updateFilters);

        // فتح وإغلاق الواجهة عند الضغط على الأيقونة الدائرية
        sBtn.onclick = () => menu.style.display = menu.style.display === "none" ? "block" : "none";

        // زر البحث عن مانهوا
        document.getElementById('s-go-search').onclick = function() {
            const query = document.getElementById('s-input').value;
            if (query) {
                window.open(`https://www.google.com/search?q=${encodeURIComponent(query + " manga webtoon")}`);
            }
        };

        // تنظيف الصفحة من الإعلانات والهوامش المزعجة
        document.getElementById('s-clean').onclick = () => {
            document.querySelectorAll('header, footer, .ads, #header, .webtoon-side-ads, .banner').forEach(e => e.remove());
            showNotification("تم تنظيف الصفحة من الإعلانات المزعجة!");
        };

        // التمرير التلقائي الذكي
        let scrollInterval = null;
        document.getElementById('s-scroll').onclick = function() {
            if (scrollInterval) {
                clearInterval(scrollInterval);
                scrollInterval = null;
                this.style.background = "#222";
                this.style.color = "#fff";
            } else {
                scrollInterval = setInterval(() => {
                    window.scrollBy(0, parseInt(document.getElementById('r-speed').value));
                }, 20);
                this.style.background = "#00f2fe";
                this.style.color = "#000";
            }
        };
        document.getElementById('r-speed').oninput = (e) => document.getElementById('v-speed').innerText = e.target.value;

        // ميزة سحب الواجهة باللمس (مهمة للهواتف)
        let isDragging = false;
        let startX, startY;
        
        sBtn.ontouchstart = (e) => {
            isDragging = true;
            startX = e.touches[0].clientX - root.offsetLeft;
            startY = e.touches[0].clientY - root.offsetTop;
        };

        document.ontouchend = () => {
            if (isDragging) {
                isDragging = false;
                localStorage.setItem('slax_x', root.style.left);
                localStorage.setItem('slax_y', root.style.top);
            }
        };

        document.ontouchmove = (e) => {
            if (!isDragging) return;
            root.style.left = (e.touches[0].clientX - startX) + 'px';
            root.style.top = (e.touches[0].clientY - startY) + 'px';
            e.preventDefault();
        };
    }

    setTimeout(createSlaxUI, 1000);
})();

```
