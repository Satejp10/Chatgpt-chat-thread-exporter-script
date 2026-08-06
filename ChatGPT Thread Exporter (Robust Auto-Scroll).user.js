// ==UserScript==
// @name         ChatGPT Thread Exporter (Robust Auto-Scroll)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Exports full ChatGPT threads (defeats virtualization/lazy loading) to Markdown/HTML with copy buttons.
// @author       You
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function extractText(element) {
        const clone = element.cloneNode(true);
        clone.querySelectorAll('.custom-copy-btn, button, svg, img, [class*="btn"]').forEach(el => el.remove());
        return clone.innerText.trim();
    }

    function downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function addCopyButtons() {
        const messages = document.querySelectorAll('[data-message-author-role]');
        messages.forEach(msg => {
            if (!msg.querySelector('.custom-copy-btn')) {
                const btn = document.createElement('button');
                btn.className = 'custom-copy-btn';
                btn.innerText = 'Copy';
                btn.style.cssText = `
                    position: absolute; top: 5px; right: 5px; z-index: 10; 
                    padding: 2px 8px; font-size: 12px; background: #10a37f; color: white; 
                    border: none; border-radius: 4px; cursor: pointer; opacity: 0.8;
                `;
                btn.onmouseenter = () => btn.style.opacity = '1';
                btn.onmouseleave = () => btn.style.opacity = '0.8';
                
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const text = extractText(msg);
                    navigator.clipboard.writeText(text).then(() => {
                        btn.innerText = 'Copied!';
                        setTimeout(() => btn.innerText = 'Copy', 1500);
                    });
                };

                if (getComputedStyle(msg).position === 'static') {
                    msg.style.position = 'relative';
                }
                msg.appendChild(btn);
            }
        });
    }

    // NEW: Bulletproof auto-scroll engine
    async function getAllMessages() {
        const messages = [];
        const seenIds = new Set();
        
        const collect = () => {
            document.querySelectorAll('[data-message-author-role]').forEach(msg => {
                const text = extractText(msg);
                if (!text) return; 
                const id = msg.getAttribute('data-message-id') || `${msg.getAttribute('data-message-author-role')}-${text.substring(0, 50)}`;
                if (!seenIds.has(id)) {
                    seenIds.add(id);
                    messages.push({
                        role: msg.getAttribute('data-message-author-role'),
                        text: text
                    });
                }
            });
        };

        const loader = document.createElement('div');
        loader.id = 'chat-export-loader';
        loader.innerText = 'Scrolling to load all messages... (0%)';
        loader.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(30,30,30,0.95); color:white; padding:20px 30px; border-radius:8px; z-index:99999; font-size:16px; font-family:sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); text-align:center; min-width:250px;';
        document.body.appendChild(loader);

        // 1. Find the EXACT hidden scrollable container ChatGPT uses
        let scroller = null;
        let maxScrollHeight = 0;
        let allElements = document.querySelectorAll('*');
        
        for (let el of allElements) {
            if (el.scrollHeight > el.clientHeight + 50) {
                let style = window.getComputedStyle(el);
                if (style.overflow === 'auto' || style.overflow === 'scroll' || 
                    style.overflowY === 'auto' || style.overflowY === 'scroll') {
                    if (el.scrollHeight > maxScrollHeight) {
                        maxScrollHeight = el.scrollHeight;
                        scroller = el;
                    }
                }
            }
        }

        const isWindowScroll = !scroller || scroller === document.documentElement || scroller === document.body;
        const scrollStep = isWindowScroll ? window.innerHeight * 0.9 : scroller.clientHeight * 0.8;
        
        // 2. Force scroll to the absolute top to render the first messages
        if (isWindowScroll) {
            window.scrollTo(0, 0);
        } else {
            scroller.scrollTop = 0;
        }
        await sleep(600);
        collect();

        // 3. Scroll down slowly to force rendering and capture
        let lastScrollPos = -1;
        let currentScrollPos = isWindowScroll ? window.scrollY : scroller.scrollTop;
        let safety = 0;
        
        while (currentScrollPos !== lastScrollPos && safety < 300) {
            lastScrollPos = currentScrollPos;
            
            if (isWindowScroll) {
                window.scrollBy(0, scrollStep);
                await sleep(200);
                currentScrollPos = window.scrollY;
            } else {
                scroller.scrollBy(0, scrollStep);
                await sleep(200);
                currentScrollPos = scroller.scrollTop;
            }
            
            collect();
            
            let maxScroll = isWindowScroll ? document.body.scrollHeight : scroller.scrollHeight;
            let viewHeight = isWindowScroll ? window.innerHeight : scroller.clientHeight;
            let progress = Math.min(100, Math.round((currentScrollPos / (maxScroll - viewHeight)) * 100));
            if (isNaN(progress)) progress = 100;
            
            loader.innerText = `Scrolling to load all messages...\nProgress: ${progress}%\nFound ${messages.length} messages so far.`;
            
            safety++;
            
            // Check if we hit the bottom
            if (isWindowScroll) {
                if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 10) break;
            } else {
                if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 10) break;
            }
        }

        // 4. Restore scroll position so you aren't disoriented
        if (isWindowScroll) {
            window.scrollTo(0, document.body.scrollHeight);
        } else if (scroller) {
            scroller.scrollTop = scroller.scrollHeight;
        }

        loader.remove();
        return messages;
    }

    async function exportChat(format) {
        const messages = await getAllMessages();
        let output = '';

        if (format === 'markdown') {
            output += `# ChatGPT Export\n\n`;
            messages.forEach(msg => {
                output += `## ${msg.role === 'user' ? 'User' : 'Assistant'}\n\n${msg.text}\n\n`;
            });
            downloadFile(output, 'chatgpt-export.md', 'text/markdown');
            
        } else if (format === 'html') {
            output += `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ChatGPT Thread Export</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f9f9f9; color: #333; }
  .message { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 20px; position: relative; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
  .message.user { background: #eef2ff; border-color: #d1d8ff; }
  .message h3 { margin-top: 0; font-size: 1.1em; color: #555; }
  .content { white-space: pre-wrap; word-wrap: break-word; margin-top: 10px; line-height: 1.6; }
  .copy-btn { position: absolute; top: 10px; right: 10px; padding: 5px 10px; background: #10a37f; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .copy-btn:hover { background: #0d8a6a; }
</style>
</head>
<body>
  <h1>ChatGPT Thread Export</h1>`;

            messages.forEach(msg => {
                const escapedText = msg.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                output += `
  <div class="message ${msg.role}">
    <h3>${msg.role === 'user' ? 'User' : 'Assistant'}</h3>
    <button class="copy-btn">Copy</button>
    <div class="content">${escapedText}</div>
  </div>`;
            });

            output += `
  <script>
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.nextElementSibling.innerText;
        navigator.clipboard.writeText(text).then(() => {
          btn.innerText = 'Copied!';
          setTimeout(() => { btn.innerText = 'Copy'; }, 2000);
        });
      });
    });
  </script>
</body>
</html>`;
            downloadFile(output, 'chatgpt-export.html', 'text/html');
        }
    }

    function showExportModal() {
        if (document.querySelector('.export-modal-overlay')) return;
        
        const overlay = document.createElement('div');
        overlay.className = 'export-modal-overlay';
        overlay.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:99999;`;
        
        const modal = document.createElement('div');
        modal.style.cssText = `background:white; padding:30px; border-radius:12px; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.2);`;
        modal.innerHTML = `
            <h3 style="margin-top:0; color:#333;">Export Chat Thread</h3>
            <p style="color:#666; margin-bottom:20px;">Choose your preferred format:<br><small>(Will auto-scroll to capture everything)</small></p>
            <button class="modal-btn md-btn">Download Markdown</button>
            <button class="modal-btn html-btn">Download HTML</button>
            <br><button class="modal-btn close-btn" style="margin-top:20px; background:#ccc;">Cancel</button>
        `;
        
        const styles = document.createElement('style');
        styles.innerHTML = `
            .modal-btn { padding:10px 20px; font-size:14px; border:none; border-radius:6px; cursor:pointer; color:white; margin:5px; }
            .md-btn { background:#2563eb; }
            .html-btn { background:#10a37f; }
            .close-btn { background:#6b7280 !important; }
            .modal-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        document.head.appendChild(styles);
        
        const handleExport = async (format, btn) => {
            const allBtns = modal.querySelectorAll('.modal-btn');
            allBtns.forEach(b => b.disabled = true);
            btn.innerText = 'Loading...';
            
            await exportChat(format);
            
            overlay.remove(); 
            styles.remove();
        };

        overlay.querySelector('.md-btn').onclick = (e) => handleExport('markdown', e.target);
        overlay.querySelector('.html-btn').onclick = (e) => handleExport('html', e.target);
        overlay.querySelector('.close-btn').onclick = () => { overlay.remove(); styles.remove(); };
        overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); styles.remove(); } };
    }

    function addExportButton() {
        if (document.querySelector('.export-chat-btn')) return;
        
        const btn = document.createElement('button');
        btn.className = 'export-chat-btn';
        btn.innerText = 'Export Chat';
        btn.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 9999; 
            padding: 10px 15px; background: #10a37f; color: white; 
            border: none; border-radius: 8px; cursor: pointer; 
            box-shadow: 0 4px 6px rgba(0,0,0,0.1); font-size: 14px; font-weight: bold;
        `;
        btn.onclick = showExportModal;
        document.body.appendChild(btn);
    }

    const observer = new MutationObserver(() => {
        addCopyButtons();
        addExportButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    
    addCopyButtons();
    addExportButton();
})();