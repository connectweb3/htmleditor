import os
import uuid
import json
from flask import Flask, render_template, request, jsonify, send_file, make_response
from bs4 import BeautifulSoup
import io

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload

# Global store for simplicity in this session (in production, use DB or session)
# storage = { 'session_id': { 'html': '...', 'soup': ... } }
# But since we can't easily pickle soup, we'll re-parse or store string.
# Let's just store the HTML string in memory keyed by a session ID.
HTML_STORE = {}

def generate_element_id():
    return f"ai-edit-{uuid.uuid4().hex[:8]}"

def parse_html_for_editing(html_content):
    soup = BeautifulSoup(html_content, 'lxml')
    editable_elements = []
    
    # Define tags we want to make editable
    target_tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'img', 'span', 'li', 'button']
    
    for tag in soup.find_all(target_tags):
        # Skip empty tags or tags that are purely structural heavy wrappers
        # (Heuristic: if it has direct text or specific attributes)
        
        has_text = bool(tag.get_text(strip=True))
        is_media = tag.name in ['img']
        is_link = tag.name in ['a']
        
        if not (has_text or is_media):
            continue
            
        # Assign a temp unique ID if not present, to track it for updates
        # We will embed this ID into the HTML so we can find it later
        if not tag.has_attr('data-ai-id'):
            uid = generate_element_id()
            tag['data-ai-id'] = uid
        else:
            uid = tag['data-ai-id']
            
        element_data = {
            'id': uid,
            'tag': tag.name,
            'label': f"{tag.name.upper()} - {tag.get_text(strip=True)[:30]}..." if has_text else f"{tag.name.upper()}",
            'content': tag.get_text(strip=True) if has_text else "",
            'attributes': {}
        }
        
        if is_media:
            element_data['attributes']['src'] = tag.get('src', '')
            element_data['label'] += f" (Image)"
            
        if is_link:
            element_data['attributes']['href'] = tag.get('href', '')
            
        editable_elements.append(element_data)
        
    return str(soup), editable_elements

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/analyze', methods=['POST'])
def analyze():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    if file:
        content = file.read().decode('utf-8', errors='ignore')
        # Parse and inject IDs
        tagged_html, elements = parse_html_for_editing(content)
        
        # Store for generic session access (using a simple key for now)
        # In a real app, use a session cookie or return a token.
        # We'll return a token to the client.
        token = uuid.uuid4().hex
        HTML_STORE[token] = tagged_html
        
        return jsonify({
            'token': token,
            'elements': elements,
            # We also return the tagged HTML for the preview iframe
            'preview_html': tagged_html 
        })

@app.route('/preview/<token>')
def preview(token):
    if token in HTML_STORE:
        return HTML_STORE[token]
    return "Session expired or invalid", 404

@app.route('/generate', methods=['POST'])
def generate():
    data = request.json
    token = data.get('token')
    updates = data.get('updates') # List of {id, content, attributes}
    
    if not token or token not in HTML_STORE:
        return jsonify({'error': 'Invalid session'}), 400
        
    original_html = HTML_STORE[token]
    soup = BeautifulSoup(original_html, 'lxml')
    
    for update in updates:
        uid = update.get('id')
        new_content = update.get('content')
        new_attrs = update.get('attributes', {})
        
        # Find by our injected data-ai-id
        tag = soup.find(attrs={"data-ai-id": uid})
        if tag:
            # Update text if it's not a self-closing/void tag or if logic permits
            if tag.name not in ['img', 'br', 'hr', 'input']:
                if new_content is not None:
                    tag.string = new_content
            
            # Update attributes
            for attr, val in new_attrs.items():
                tag[attr] = val
                
            # Clean up our tracking ID before finalizing? 
            # Ideally yes, but for "preview" we might want to keep it.
            # Let's say this generate enpoint is for the FINAL download, so we remove it.
            if data.get('final', False):
                del tag['data-ai-id']

    updated_html = str(soup)
    
    # Update store if not final, so preview keeps working with latest state
    if not data.get('final', False):
        HTML_STORE[token] = updated_html
        return jsonify({'status': 'ok'})
    else:
        # cleanup
        # del HTML_STORE[token] 
        pass

    # For download
    mem_file = io.BytesIO()
    mem_file.write(updated_html.encode('utf-8'))
    mem_file.seek(0)
    
    return send_file(
        mem_file,
        as_attachment=True,
        download_name='updated_portfolio.html',
        mimetype='text/html'
    )

if __name__ == '__main__':
    app.run(debug=True, port=5000)
