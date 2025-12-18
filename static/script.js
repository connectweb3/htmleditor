document.addEventListener('DOMContentLoaded', () => {
    // --- Selectors ---
    const uploadArea = document.querySelector('.upload-area');
    const fileInput = document.getElementById('file-input');
    const uploadView = document.getElementById('upload-view');
    const editorView = document.getElementById('editor-view');
    const sidebarContent = document.querySelector('.sidebar-content');
    const previewFrame = document.getElementById('preview-frame');

    // Search & Undo Inputs
    const searchInput = document.getElementById('search-input');
    const replaceInput = document.getElementById('replace-input');
    const btnFind = document.getElementById('btn-find');
    const btnReplace = document.getElementById('btn-replace');
    const btnReplaceAll = document.getElementById('btn-replace-all');

    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');

    // --- State ---
    let currentToken = null;
    // History Stack
    const historyStack = [];
    let historyPointer = -1; // Points to the current state in stack

    // Command Constants
    const CMD_UPDATE = 'UPDATE';
    const CMD_ADD = 'ADD';
    const CMD_REMOVE = 'REMOVE';
    const CMD_ADD_SECTION = 'ADD_SECTION';
    const CMD_REMOVE_SECTION = 'REMOVE_SECTION';

    // --- Initialization ---

    // Drag & Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults, false);
    });
    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
    ['dragenter', 'dragover'].forEach(name => uploadArea.addEventListener(name, () => uploadArea.classList.add('dragover'), false));
    ['dragleave', 'drop'].forEach(name => uploadArea.addEventListener(name, () => uploadArea.classList.remove('dragover'), false));
    uploadArea.addEventListener('drop', handleDrop, false);
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    function handleDrop(e) { handleFiles(e.dataTransfer.files); }
    function handleFiles(files) { if (files.length > 0) uploadFile(files[0]); }

    function uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        document.querySelector('.upload-area p').textContent = "Analyzing structure...";

        fetch('/analyze', { method: 'POST', body: formData })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    alert(data.error);
                    return;
                }
                currentToken = data.token;
                // Delay slightly to allow iframe source to be set? 
                // Actually, we set src then wait for load or just init.
                initializeEditor(data);
            })
            .catch(err => alert("Error uploading file"));
    }

    function initializeEditor(data) {
        uploadView.classList.add('hidden');
        editorView.style.display = 'flex';
        previewFrame.src = `/preview/${data.token}`;

        // Wait for iframe to load to ensure valid DOM
        previewFrame.onload = () => {
            refreshSidebarFromPreview();
        };
    }

    // --- Core Logic: Helper to get elements from Iframe ---
    function getIframeDoc() {
        return previewFrame.contentDocument || previewFrame.contentWindow.document;
    }

    function refreshSidebarFromPreview() {
        sidebarContent.innerHTML = '';
        const doc = getIframeDoc();
        const elements = Array.from(doc.querySelectorAll('[data-ai-id]'));

        let lastParent = null;
        let currentGroupContainer = null;

        elements.forEach(el => {
            const parent = el.parentNode;

            // Check if we need to start a new section group
            // We ignore 'body' or 'html' as "sections" to duplicate usually, 
            // but if the user wants to duplicate a direct child of body (like a main wrapper), that's fine.
            // Let's just group by whatever parent these elements share.
            if (parent !== lastParent) {
                lastParent = parent;
                currentGroupContainer = createSectionGroup(parent, el); // Pass el as a reference to finding this section later
                sidebarContent.appendChild(currentGroupContainer);
            }

            // Add the element form to the current group/sidebar
            // Actually, createSectionGroup returns a container for the *children* forms?
            // Let's make createSectionGroup return the wrapper.
            // But we need to append the element form *inside* that wrapper? 
            // Or just append to sidebar if we want flat look with headers?
            // Grouping visually "inside" a box is nicer.
            const fieldGroup = createFormGroup(el);
            currentGroupContainer.querySelector('.section-content').appendChild(fieldGroup);
        });

        // Add Download Button
        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn';
        dlBtn.textContent = 'Download Updated HTML';
        dlBtn.style.marginTop = '2rem';
        dlBtn.style.width = '100%';
        dlBtn.onclick = downloadResult;
        sidebarContent.appendChild(dlBtn);
    }

    function createSectionGroup(parentEl, refChildEl) {
        const wrapper = document.createElement('div');
        wrapper.className = 'section-group';
        wrapper.style.border = '1px solid #333';
        wrapper.style.marginBottom = '1rem';
        wrapper.style.borderRadius = '8px';
        wrapper.style.overflow = 'hidden';

        const header = document.createElement('div');
        header.className = 'section-header';
        header.style.background = '#222';
        header.style.padding = '0.5rem 1rem';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';

        const label = document.createElement('span');
        const tagName = parentEl.tagName.toLowerCase();
        // Try to identify it nicely (e.g. class or id)
        const idStr = parentEl.id ? `#${parentEl.id}` : '';
        const classStr = parentEl.className ? `.${parentEl.className.split(' ')[0]}` : '';
        label.textContent = `SECTION <${tagName}${idStr}${classStr}>`;
        label.style.fontWeight = 'bold';
        label.style.fontSize = '0.85rem';
        label.style.color = '#aaa';

        const actions = document.createElement('div');

        // Duplicate Section Button
        const btnDup = document.createElement('button');
        btnDup.className = 'btn-sm';
        btnDup.textContent = 'Duplicate';
        btnDup.title = 'Duplicate this entire section';
        btnDup.onclick = () => {
            // We use the reference child ID to find the section again 
            // (since parent might not have an ID)
            executeCommand({
                type: CMD_ADD_SECTION,
                refId: refChildEl.getAttribute('data-ai-id')
            });
        };

        actions.appendChild(btnDup);
        header.appendChild(label);
        header.appendChild(actions);
        wrapper.appendChild(header);

        const content = document.createElement('div');
        content.className = 'section-content';
        content.style.padding = '1rem';
        wrapper.appendChild(content);

        return wrapper;
    }

    // --- Form Creation ---
    function createFormGroup(el) {
        const id = el.getAttribute('data-ai-id');
        const tagName = el.tagName.toLowerCase();

        // Container
        const group = document.createElement('div');
        group.className = 'form-group';
        group.dataset.linkedId = id; // Link form group to element ID for removal handling

        // Header Row (Label + Actions)
        const headerRow = document.createElement('div');
        headerRow.className = 'form-header-row';

        const label = document.createElement('label');
        label.textContent = tagName.toUpperCase();
        label.style.marginBottom = '0';
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = id.substr(-4);
        label.appendChild(badge);

        const actions = document.createElement('div');

        // Duplicate Btn
        const btnDup = document.createElement('button');
        btnDup.className = 'action-btn duplicate';
        btnDup.innerHTML = '✚';
        btnDup.title = 'Duplicate Element';
        btnDup.onclick = () => executeCommand({ type: CMD_ADD, id: id });

        // Delete Btn
        const btnDel = document.createElement('button');
        btnDel.className = 'action-btn delete';
        btnDel.innerHTML = '🗑';
        btnDel.title = 'Remove Element';
        btnDel.onclick = () => executeCommand({ type: CMD_REMOVE, id: id });

        actions.appendChild(btnDup);
        actions.appendChild(btnDel);

        headerRow.appendChild(label);
        headerRow.appendChild(actions);
        group.appendChild(headerRow);

        // Content Input
        // Simple heuristic: if img/br/hr -> no text content usually
        if (!['img', 'br', 'hr', 'input'].includes(tagName)) {
            const val = el.innerText; // Use innerText to preserve rudimentary format? or textContent?
            // Using textContent is safer for pure text editing.
            const input = val.length > 50 ? document.createElement('textarea') : document.createElement('input');
            if (val.length <= 50) input.type = 'text';
            input.value = val;
            input.dataset.id = id;
            input.dataset.field = 'content';
            input.dataset.originalValue = val; // Snapshot for Undo

            // On Focus -> Snapshot for Undo
            input.addEventListener('focus', (e) => {
                e.target.dataset.originalValue = e.target.value;
                highlightPreviewElement(id, true);
            });

            // On Blur/Change -> Commit Command
            input.addEventListener('change', (e) => {
                const oldVal = e.target.dataset.originalValue;
                const newVal = e.target.value;
                if (oldVal !== newVal) {
                    executeCommand({
                        type: CMD_UPDATE,
                        id: id,
                        field: 'content',
                        oldValue: oldVal,
                        newValue: newVal
                    });
                    // Update snapshot
                    e.target.dataset.originalValue = newVal;
                }
            });

            // Live Update
            input.addEventListener('input', (e) => {
                el.textContent = e.target.value;
            });
            input.addEventListener('blur', () => highlightPreviewElement(id, false));

            group.appendChild(input);
        }

        // Attributes
        if (tagName === 'img') {
            createAttrInput(group, el, id, 'src');
            createAttrInput(group, el, id, 'alt');
        }
        if (tagName === 'a') {
            createAttrInput(group, el, id, 'href');
        }

        return group;
    }

    function createAttrInput(group, el, id, attr) {
        const val = el.getAttribute(attr) || '';
        const lbl = document.createElement('label');
        lbl.textContent = attr;
        lbl.style.fontSize = '0.7em';
        group.appendChild(lbl);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = val;
        input.dataset.id = id;
        input.dataset.field = 'attr-' + attr;
        input.dataset.originalValue = val;

        input.addEventListener('focus', (e) => {
            e.target.dataset.originalValue = e.target.value;
            highlightPreviewElement(id, true);
        });

        input.addEventListener('change', (e) => {
            const oldVal = e.target.dataset.originalValue;
            const newVal = e.target.value;
            // execute command...
            executeCommand({
                type: CMD_UPDATE,
                id: id,
                field: 'attr-' + attr,
                oldValue: oldVal,
                newValue: newVal
            });
            e.target.dataset.originalValue = newVal;
        });

        input.addEventListener('input', (e) => {
            el.setAttribute(attr, e.target.value);
        });
        input.addEventListener('blur', () => highlightPreviewElement(id, false));

        group.appendChild(input);
    }

    // --- Command / Undo / Redo Manager ---
    // Stack contains Command Objects

    function executeCommand(cmd) {
        // If we are not at tip, slice stack
        if (historyPointer < historyStack.length - 1) {
            historyStack.splice(historyPointer + 1);
        }

        historyStack.push(cmd);
        historyPointer++;
        updateUndoRedoButtons();

        // Execute Action (if not already done by direct event)
        // Note: UPDATE actions are usually done by the 'input' event, 
        // we just record them on 'change'.
        // BUT ADD/REMOVE must be executed here.

        if (cmd.type === CMD_ADD || cmd.type === CMD_REMOVE) {
            applyAction(cmd, false);
            if (cmd.type === CMD_ADD) performAdd(cmd);
            if (cmd.type === CMD_REMOVE) performRemove(cmd);
        }
        if (cmd.type === CMD_ADD_SECTION || cmd.type === CMD_REMOVE_SECTION) {
            // Handled similarly
            if (cmd.type === CMD_ADD_SECTION) performAddSection(cmd);
            if (cmd.type === CMD_REMOVE_SECTION) performRemoveSection(cmd);
        }
    }

    function performAdd(cmd) {
        const doc = getIframeDoc();
        const refEl = doc.querySelector(`[data-ai-id="${cmd.id}"]`);
        if (!refEl) return;

        // Clone
        const newEl = refEl.cloneNode(true);
        // Generate new ID
        // If we enter this from a Redo, we might want to reuse an ID if stored?
        // Let's store the newID in the command so Redo uses same ID.
        if (!cmd.newId) cmd.newId = 'ai-edit-' + Math.random().toString(36).substr(2, 9);

        newEl.setAttribute('data-ai-id', cmd.newId);
        // Insert after
        refEl.parentNode.insertBefore(newEl, refEl.nextSibling);

        // Refresh UI (Expensive but safe)
        refreshSidebarFromPreview();

        // Highlight new
        setTimeout(() => highlightPreviewElement(cmd.newId, true), 100);
        setTimeout(() => highlightPreviewElement(cmd.newId, false), 1000);
    }

    function performRemove(cmd) {
        const doc = getIframeDoc();
        const el = doc.querySelector(`[data-ai-id="${cmd.id}"]`);
        if (!el) return;

        // We need to store the parent and next sibling to undo later?
        // Or store the element itself (outerHTML).
        // Actually, just hiding it? No, structure edit means Remove.
        // To Undo, we need to re-insert.
        // Let's store outerHTML in command if not present
        if (!cmd.htmlSnapshot) cmd.htmlSnapshot = el.outerHTML;
        if (!cmd.nextSiblingId) {
            const next = el.nextElementSibling;
            if (next && next.hasAttribute('data-ai-id')) cmd.nextSiblingId = next.getAttribute('data-ai-id');
        }
        if (!cmd.parentId) {
            // We can find parent by generic path or just id of parent if marked...
            // Fallback: we assume specific parent logic or just use insertBefore behavior
        }

        el.remove();
        refreshSidebarFromPreview();
    }

    function performAddSection(cmd) {
        const doc = getIframeDoc();
        const refEl = doc.querySelector(`[data-ai-id="${cmd.refId}"]`);
        if (!refEl) return;
        const parentSection = refEl.parentNode;
        if (!parentSection) return;

        // Clone
        const newSection = parentSection.cloneNode(true);

        // Initialize ID Map if new command
        if (!cmd.idMap) cmd.idMap = [];

        // RE-ID All Children in the clone
        const taggedElements = Array.from(newSection.querySelectorAll('[data-ai-id]'));

        // Also check if the section itself has an ID
        if (newSection.hasAttribute('data-ai-id')) {
            if (!cmd.sectionOwnId) cmd.sectionOwnId = generateId();
            newSection.setAttribute('data-ai-id', cmd.sectionOwnId);
        }

        taggedElements.forEach((el, index) => {
            let newId;
            if (cmd.idMap[index]) {
                newId = cmd.idMap[index];
            } else {
                newId = generateId();
                cmd.idMap[index] = newId;
            }
            el.setAttribute('data-ai-id', newId);
        });

        // Track the added section for Undo
        if (!cmd.tempSectionId) cmd.tempSectionId = 'section-' + generateId();
        newSection.dataset.tempSectionId = cmd.tempSectionId;

        // Insert
        parentSection.parentNode.insertBefore(newSection, parentSection.nextSibling);

        refreshSidebarFromPreview();

        // Highlight logic
        setTimeout(() => {
            newSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            newSection.style.outline = '2px dashed #0f0';
            setTimeout(() => newSection.style.outline = '', 1000);
        }, 100);
    }

    function performRemoveSection(cmd) {
        // Undo of Add Section
        const doc = getIframeDoc();
        // Find by the temp ID we assigned
        // Note: querySelector for data attributes needs quotes
        // But wait, performRemoveSection is for undoing ADD? No, that's handled in applyAction usually?
        // Ah, our pattern is: executeCommand -> calls perform...
        // undo -> calls applyAction -> which calls logic.
        // We need to wire up applyAction to handle ADD_SECTION too.
    }

    function generateId() {
        return 'ai-edit-' + Math.random().toString(36).substr(2, 9);
    }

    function undo() {
        if (historyPointer < 0) return;
        const cmd = historyStack[historyPointer];

        applyAction(cmd, true); // isUndo = true
        historyPointer--;
        updateUndoRedoButtons();
    }

    function redo() {
        if (historyPointer >= historyStack.length - 1) return;
        historyPointer++;
        const cmd = historyStack[historyPointer];

        applyAction(cmd, false); // isUndo = false
        updateUndoRedoButtons();
    }

    function applyAction(cmd, isUndo) {
        const doc = getIframeDoc();

        if (cmd.type === CMD_UPDATE) {
            const el = doc.querySelector(`[data-ai-id="${cmd.id}"]`);
            if (!el) return;
            const val = isUndo ? cmd.oldValue : cmd.newValue;

            if (cmd.field === 'content') {
                el.innerText = val;
                const input = sidebarContent.querySelector(`input[data-id="${cmd.id}"][data-field="content"], textarea[data-id="${cmd.id}"][data-field="content"]`);
                if (input) input.value = val;
            } else if (cmd.field.startsWith('attr-')) {
                const attr = cmd.field.replace('attr-', '');
                el.setAttribute(attr, val);
                const input = sidebarContent.querySelector(`input[data-id="${cmd.id}"][data-field="${cmd.field}"]`);
                if (input) input.value = val;
            }
            highlightPreviewElement(cmd.id, true);
            setTimeout(() => highlightPreviewElement(cmd.id, false), 500);
        }
        else if (cmd.type === CMD_ADD) {
            if (isUndo) {
                const el = doc.querySelector(`[data-ai-id="${cmd.newId}"]`);
                if (el) el.remove();
                refreshSidebarFromPreview();
            } else {
                const refEl = doc.querySelector(`[data-ai-id="${cmd.id}"]`);
                if (!refEl) return;
                const newEl = refEl.cloneNode(true);
                newEl.setAttribute('data-ai-id', cmd.newId);
                refEl.parentNode.insertBefore(newEl, refEl.nextSibling);
                refreshSidebarFromPreview();
            }
        }
        else if (cmd.type === CMD_REMOVE) {
            if (isUndo) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = cmd.htmlSnapshot;
                const restoredEl = tempDiv.firstChild;
                let inserted = false;
                if (cmd.nextSiblingId) {
                    const sibling = doc.querySelector(`[data-ai-id="${cmd.nextSiblingId}"]`);
                    if (sibling && sibling.parentNode) {
                        sibling.parentNode.insertBefore(restoredEl, sibling);
                        inserted = true;
                    }
                }
                if (!inserted) {
                    alert("Undo Remove might misplace element if structure complex.");
                }
                refreshSidebarFromPreview();
            } else {
                const el = doc.querySelector(`[data-ai-id="${cmd.id}"]`);
                if (el) el.remove();
                refreshSidebarFromPreview();
            }
        }
        else if (cmd.type === CMD_ADD_SECTION) {
            if (isUndo) {
                // Remove the section we added
                // We stored a temp ID on it
                if (cmd.tempSectionId) {
                    // We need to find the element with data-temp-section-id
                    // But attributes in DOM are dashed... dataset is camelCase
                    // css selector: [data-temp-section-id="..."]
                    const section = doc.querySelector(`[data-temp-section-id="${cmd.tempSectionId}"]`);
                    if (section) section.remove();
                    refreshSidebarFromPreview();
                }
            } else {
                // Redo ADD SECTION
                // Call performAddSection again essentially
                performAddSection(cmd);
            }
        }
    }

    function updateUndoRedoButtons() {
        btnUndo.disabled = historyPointer < 0;
        btnRedo.disabled = historyPointer >= historyStack.length - 1;
        btnUndo.style.opacity = btnUndo.disabled ? 0.5 : 1;
        btnRedo.style.opacity = btnRedo.disabled ? 0.5 : 1;
    }

    btnUndo.addEventListener('click', undo);
    btnRedo.addEventListener('click', redo);


    // --- Visual Highlighting ---
    function highlightPreviewElement(id, active) {
        const doc = getIframeDoc();
        if (!doc.getElementById('ai-highlight-style')) {
            const style = doc.createElement('style');
            style.id = 'ai-highlight-style';
            // We need !important to override inline styles
            style.textContent = `.ai-active-highlight { outline: 3px solid #3b82f6 !important; outline-offset: 2px; position:relative; z-index:9999; }`;
            doc.head.appendChild(style);
        }

        const el = doc.querySelector(`[data-ai-id="${id}"]`);
        if (el) {
            if (active) {
                doc.querySelectorAll('.ai-active-highlight').forEach(e => e.classList.remove('ai-active-highlight'));
                el.classList.add('ai-active-highlight');
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                el.classList.remove('ai-active-highlight');
            }
        }
    }

    // --- Search Logic (Simplified from before) ---
    // (We reuse the previous simple search logic but adapted to new structure)
    // Actually, let's keep it simple.

    let searchMatches = [];
    let currentMatchIndex = -1;

    btnFind.addEventListener('click', () => {
        const term = searchInput.value.toLowerCase();
        if (!term) return;
        document.querySelectorAll('.match-highlight').forEach(e => e.classList.remove('match-highlight'));
        searchMatches = [];
        const inputs = sidebarContent.querySelectorAll('input, textarea');
        inputs.forEach(inp => {
            if (inp.value.toLowerCase().includes(term)) searchMatches.push(inp);
        });

        if (searchMatches.length === 0) { alert("No matches"); return; }
        currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
        const match = searchMatches[currentMatchIndex];
        match.scrollIntoView({ block: 'center' });
        match.classList.add('match-highlight');
    });

    // --- Client Side Download ---
    function downloadResult() {
        const doc = getIframeDoc();
        // Clone doc to clean it up
        const clone = doc.documentElement.cloneNode(true);

        // Remove our injected styles
        const injectedStyle = clone.querySelector('#ai-highlight-style');
        if (injectedStyle) injectedStyle.remove();

        // Remove data-ai-id attributes?
        // Yes, for clean output.
        // Also remove class ai-active-highlight
        const cleanElements = clone.querySelectorAll('*');
        cleanElements.forEach(el => {
            el.removeAttribute('data-ai-id');
            el.classList.remove('ai-active-highlight');
        });

        const finalHtml = "<!DOCTYPE html>\n" + clone.outerHTML;
        const blob = new Blob([finalHtml], { type: 'text/html' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "portfolio-edited-final.html";
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
});
