"""CDP Explorer for fistest.ciwork.cn - Phase 2 & 3 BFS exploration"""
import json
import time
import base64
import os
from websocket import create_connection

PAGE_ID = "16071137242AD51C82F7467B2EB28D05"
WS_URL = f"ws://localhost:9222/devtools/page/{PAGE_ID}"
SCREENSHOT_DIR = r"E:\Clark_agent\tests\e2e\screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

msg_id = 0

def send(ws, method, params=None):
    global msg_id
    msg_id += 1
    req = {"id": msg_id, "method": method, "params": params or {}}
    ws.send(json.dumps(req))
    while True:
        raw = ws.recv()
        data = json.loads(raw)
        if data.get("id") == msg_id:
            return data.get("result", {})

def evaluate(ws, js):
    result = send(ws, "Runtime.evaluate", {
        "expression": js,
        "returnByValue": True,
        "awaitPromise": True,
        "timeout": 10000
    })
    if "exceptionDetails" in result:
        return {"error": str(result["exceptionDetails"])}
    return result.get("value", {})

def screenshot(ws, name):
    result = send(ws, "Page.captureScreenshot", {"format": "jpeg", "quality": 70})
    data = result.get("data", "")
    if data:
        path = os.path.join(SCREENSHOT_DIR, f"{name}.jpg")
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path
    return None

def wait_stable(ws, ms=1500):
    time.sleep(ms / 1000)

DOM_SCAN_JS = """
(function() {
  var interactiveSelectors = [
    'button:not([disabled])', 'a[href]', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="link"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
    '[aria-haspopup]', '[tabindex]:not([tabindex="-1"])',
    '[data-testid]', '.el-menu-item', '.el-sub-menu__title'
  ];
  var elements = [];
  var seen = new Set();
  document.querySelectorAll(interactiveSelectors.join(',')).forEach(function(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    var text = (el.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 80);
    var testId = el.getAttribute('data-testid') || '';
    var ariaLabel = el.getAttribute('aria-label') || '';
    var role = el.getAttribute('role') || el.tagName.toLowerCase();
    var name = el.getAttribute('name') || '';
    var placeholder = el.getAttribute('placeholder') || '';
    var type = el.getAttribute('type') || '';
    var href = el.getAttribute('href') || '';
    var id = el.id || '';
    var cls = (typeof el.className === 'string' ? el.className : '').split(' ')
      .filter(function(c) { return c && !c.match(/^(el-icon|is-|hover|active|focus)/); })
      .slice(0, 3).join(' ');
    var key = role + '|' + text.substring(0, 30) + '|' + ariaLabel + '|' + id;
    if (seen.has(key)) return;
    seen.add(key);
    // Build best locator
    var locator;
    if (testId) locator = '[data-testid="' + testId + '"]';
    else if (id && !id.match(/^rc_/)) locator = '#' + id;
    else if (ariaLabel) locator = '[aria-label="' + ariaLabel + '"]';
    else if (name) locator = '[name="' + name + '"]';
    else if (placeholder) locator = '[placeholder="' + placeholder + '"]';
    else locator = el.tagName.toLowerCase() + (cls ? '.' + cls.split(' ')[0] : '');

    elements.push({
      tag: el.tagName.toLowerCase(),
      role: role,
      text: text,
      testId: testId,
      ariaLabel: ariaLabel,
      name: name,
      placeholder: placeholder,
      type: type,
      href: href,
      id: id,
      className: cls,
      locatorHint: locator,
      ariaExpanded: el.getAttribute('aria-expanded'),
      ariaHasPopup: el.getAttribute('aria-haspopup'),
      disabled: !!el.disabled,
      rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)}
    });
  });
  return {
    url: location.href,
    title: document.title,
    elementCount: elements.length,
    elements: elements
  };
})()
"""

NAV_MENU_JS = """
(function() {
  // Find all nav menu items and their sub-items
  var navItems = [];
  var menuGroups = document.querySelectorAll('.el-sub-menu, .el-menu-item');
  menuGroups.forEach(function(el) {
    var titleEl = el.querySelector('.el-sub-menu__title') || el;
    var text = (titleEl.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 50);
    var expanded = el.getAttribute('aria-expanded') === 'true' || el.classList.contains('is-opened');
    var subItems = [];
    if (expanded) {
      el.querySelectorAll('.el-menu-item').forEach(function(sub) {
        var subText = (sub.textContent || '').trim().replace(/\\s+/g, ' ');
        var subHref = sub.getAttribute('href') || sub.getAttribute('data-path') || '';
        subItems.push({text: subText, href: subHref, cls: sub.className.substring(0, 80)});
      });
    }
    navItems.push({
      text: text,
      expanded: expanded,
      subItemCount: subItems.length,
      subItems: subItems,
      cls: el.className.substring(0, 80)
    });
  });
  return navItems;
})()
"""

VISIBLE_ELEMENTS_JS = """
(function() {
  var sel = [
    '.el-dropdown-menu__item', '[role="option"]', '.el-select-dropdown__item',
    '.el-menu-item', '.el-dialog', '.el-dialog__header', '.el-dialog__body',
    '.el-dialog__footer button', '.el-message-box', '[role="dialog"]',
    '[role="alertdialog"]', '.el-upload', '.el-upload__input'
  ];
  var els = document.querySelectorAll(sel.join(','));
  return Array.from(els).filter(function(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).map(function(el) {
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 60),
      cls: (typeof el.className === 'string' ? el.className : '').substring(0, 80),
      visible: true
    };
  }).slice(0, 80);
})()
"""

def click_element(ws, selector, timeout_ms=2000):
    """Click element via CDP"""
    # Get element coordinates
    js = f"""
(function() {{
  var el = document.querySelector('{selector}');
  if (!el) return null;
  var r = el.getBoundingClientRect();
  return {{x: r.x + r.width/2, y: r.y + r.height/2, found: true, text: (el.textContent||'').trim().substring(0,40)}};
}})()
"""
    pos = evaluate(ws, js)
    if not pos or not pos.get("found"):
        return False
    x, y = pos["x"], pos["y"]
    # Dispatch mouse events
    send(ws, "Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
    send(ws, "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
    wait_stable(ws, timeout_ms)
    return True

def main():
    print(f"Connecting to {WS_URL}...")
    ws = create_connection(WS_URL, timeout=15)
    print("Connected!")

    # Enable necessary domains
    send(ws, "Page.enable")
    send(ws, "Runtime.enable")

    results = {
        "explorationTarget": "https://fistest.ciwork.cn/",
        "slug": "home",
        "states": [],
        "stateGraph": {"edges": []},
        "forms": [],
        "explorationStats": {
            "statesDiscovered": 0,
            "interactionsPerformed": 0,
            "elementsFound": 0,
            "skippedDestructive": 0
        }
    }

    # =========================================================
    # Phase 2: State₀ — Initial scan
    # =========================================================
    print("\n=== Phase 2: Initial State₀ Scan ===")
    state0_elements = evaluate(ws, DOM_SCAN_JS)
    print(f"  URL: {state0_elements.get('url')}")
    print(f"  Title: {state0_elements.get('title')}")
    print(f"  Elements found: {state0_elements.get('elementCount', 0)}")

    screenshot_path = screenshot(ws, "home-S0")
    print(f"  Screenshot: {screenshot_path}")

    state0 = {
        "stateId": "S0",
        "name": "Initial - 资金流入",
        "url": state0_elements.get("url", ""),
        "title": state0_elements.get("title", ""),
        "screenshot": "home-S0.jpg",
        "elements": state0_elements.get("elements", [])
    }
    results["states"].append(state0)
    results["explorationStats"]["elementsFound"] += len(state0["elements"])

    # Extract forms info
    forms_js = """
(function() {
  var forms = [];
  document.querySelectorAll('.el-form, form').forEach(function(form) {
    var fields = [];
    form.querySelectorAll('input, select, textarea, .el-select, .el-date-editor').forEach(function(f) {
      var label = '';
      // Try to find associated label
      var formItem = f.closest('.el-form-item');
      if (formItem) {
        var labelEl = formItem.querySelector('.el-form-item__label');
        if (labelEl) label = (labelEl.textContent||'').trim();
      }
      fields.push({
        tag: f.tagName.toLowerCase(),
        type: f.getAttribute('type') || f.tagName.toLowerCase(),
        name: f.name || '',
        id: f.id || '',
        placeholder: f.getAttribute('placeholder') || '',
        required: f.required || false,
        label: label,
        ariaLabel: f.getAttribute('aria-label') || ''
      });
    });
    if (fields.length > 0) {
      forms.push({action: form.action || '', method: form.method || '', fields: fields.slice(0,20)});
    }
  });
  return forms;
})()
"""
    forms = evaluate(ws, forms_js)
    if isinstance(forms, list):
        results["forms"] = forms

    # =========================================================
    # Phase 3: BFS Exploration
    # =========================================================
    print("\n=== Phase 3: BFS Interactive Exploration ===")
    state_counter = 0
    interactions = 0

    # --- Explore Navigation Menus ---
    print("\n  [P0] Exploring navigation menus...")
    nav_data = evaluate(ws, NAV_MENU_JS)
    print(f"  Found {len(nav_data) if isinstance(nav_data, list) else 0} nav items")

    # Find collapsed sub-menus to click
    nav_click_targets = [
        ".el-sub-menu:nth-child(1) .el-sub-menu__title",  # 资金中心
        ".el-sub-menu:nth-child(2) .el-sub-menu__title",  # 发票中心
        ".el-sub-menu:nth-child(3) .el-sub-menu__title",  # 收入中心
        ".el-sub-menu:nth-child(4) .el-sub-menu__title",  # 应收中心
        ".el-sub-menu:nth-child(5) .el-sub-menu__title",  # 应付中心
    ]

    # Try clicking nav menus to get their sub-items
    # First, get text of all collapsed sub-menu titles
    nav_titles_js = """
(function() {
  var items = [];
  var subMenus = document.querySelectorAll('.el-sub-menu');
  subMenus.forEach(function(sm, i) {
    var title = sm.querySelector('.el-sub-menu__title');
    if (title) {
      var text = (title.textContent||'').trim().replace(/\\s+/g,' ').substring(0,40);
      var expanded = sm.classList.contains('is-opened');
      items.push({index: i, text: text, expanded: expanded, selector: '.el-sub-menu:nth-child('+(i+1)+') .el-sub-menu__title'});
    }
  });
  // Also check top-level menu items (not sub-menus)
  var menuItems = document.querySelectorAll('.el-menu > .el-menu-item');
  menuItems.forEach(function(mi, i) {
    var text = (mi.textContent||'').trim().replace(/\\s+/g,' ').substring(0,40);
    items.push({index: i, text: text, isMenuItem: true, expanded: false, href: mi.getAttribute('href')||''});
  });
  return items;
})()
"""
    nav_items_info = evaluate(ws, nav_titles_js)
    print(f"  Nav sub-menus: {json.dumps(nav_items_info, ensure_ascii=False)[:500]}")

    # Click first 5 nav menus to explore sub-items
    for idx in range(min(5, len(nav_items_info) if isinstance(nav_items_info, list) else 0)):
        item = nav_items_info[idx]
        if item.get("isMenuItem"):
            continue
        item_text = item.get("text", f"NavMenu_{idx}")
        # Click using nth-child
        click_js = f"""
(function() {{
  var subMenus = document.querySelectorAll('.el-sub-menu');
  if (!subMenus[{idx}]) return false;
  var title = subMenus[{idx}].querySelector('.el-sub-menu__title');
  if (!title) return false;
  title.click();
  return (title.textContent||'').trim().substring(0, 40);
}})()
"""
        clicked_text = evaluate(ws, click_js)
        if clicked_text:
            wait_stable(ws, 800)
            interactions += 1

            # Get sub-items that appeared
            sub_items_js = f"""
(function() {{
  var subMenus = document.querySelectorAll('.el-sub-menu');
  var sm = subMenus[{idx}];
  if (!sm) return [];
  var subItems = sm.querySelectorAll('.el-menu-item');
  return Array.from(subItems).map(function(si) {{
    var r = si.getBoundingClientRect();
    return {{
      text: (si.textContent||'').trim().replace(/\\s+/g,' ').substring(0,50),
      href: si.getAttribute('href') || si.getAttribute('data-path') || '',
      visible: r.width > 0 && r.height > 0,
      cls: si.className.substring(0,80)
    }};
  }}).filter(function(s) {{ return s.visible; }});
}})()
"""
            sub_items = evaluate(ws, sub_items_js)
            state_counter += 1
            state_id = f"S{state_counter}"

            state_name = f"Nav expanded - {clicked_text}"
            print(f"  → State {state_id}: {state_name} ({len(sub_items) if isinstance(sub_items, list) else 0} sub-items)")

            results["states"].append({
                "stateId": state_id,
                "name": state_name,
                "trigger": f"click nav menu {item_text}",
                "elements": sub_items if isinstance(sub_items, list) else [],
                "navMenuText": clicked_text
            })
            results["stateGraph"]["edges"].append({
                "from": "S0",
                "to": state_id,
                "action": "click",
                "element": item_text,
                "locatorHint": f".el-sub-menu:nth-child({idx+1}) .el-sub-menu__title"
            })
            results["explorationStats"]["interactionsPerformed"] += 1

    # Collapse all menus again by re-clicking expanded ones
    collapse_js = """
(function() {
  var opened = document.querySelectorAll('.el-sub-menu.is-opened');
  opened.forEach(function(sm) {
    var title = sm.querySelector('.el-sub-menu__title');
    if (title) title.click();
  });
  return opened.length;
})()
"""
    collapsed = evaluate(ws, collapse_js)
    wait_stable(ws, 800)
    print(f"  Collapsed {collapsed} menus")

    # --- Explore Filter Form Dropdowns ---
    print("\n  [P2] Exploring filter form dropdowns...")
    # Click query button first to see results
    query_click_js = """
(function() {
  var btns = document.querySelectorAll('button');
  var queryBtn = Array.from(btns).find(function(b) {
    return (b.textContent||'').trim() === '查询';
  });
  if (queryBtn) { queryBtn.click(); return true; }
  return false;
})()
"""
    query_clicked = evaluate(ws, query_click_js)
    wait_stable(ws, 1000)

    # Find and click dropdown triggers
    dropdown_selectors = [
        {"name": "流水类型", "js": """
          var el = document.querySelector('.el-form-item:nth-child(3) .el-select__wrapper, .el-form-item:nth-child(3) input');
          if (el) { el.click(); return true; } return false;
        """},
        {"name": "核销状态", "js": """
          var items = document.querySelectorAll('.el-form-item');
          var target = Array.from(items).find(function(el) { return (el.textContent||'').includes('核销状态'); });
          if (target) { var sel = target.querySelector('.el-select__wrapper, input'); if (sel) { sel.click(); return true; } }
          return false;
        """},
    ]

    for dd in dropdown_selectors:
        clicked = evaluate(ws, f"(function() {{ {dd['js']} }})()")
        wait_stable(ws, 600)
        # Get dropdown options
        options_js = """
(function() {
  var optEls = document.querySelectorAll('.el-select-dropdown__item:not([style*="display: none"]), .el-dropdown-menu__item');
  return Array.from(optEls).filter(function(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).map(function(el) {
    return (el.textContent||'').trim().replace(/\\s+/g,' ');
  }).filter(function(t) { return t; });
})()
"""
        options = evaluate(ws, options_js)
        if isinstance(options, list) and options:
            print(f"  → {dd['name']} options: {options[:8]}")
            interactions += 1
            state_counter += 1
            results["states"].append({
                "stateId": f"S{state_counter}",
                "name": f"Dropdown open - {dd['name']}",
                "trigger": f"click {dd['name']} dropdown",
                "elements": [{"text": opt, "role": "option"} for opt in options]
            })
            results["stateGraph"]["edges"].append({
                "from": "S0",
                "to": f"S{state_counter}",
                "action": "click",
                "element": dd['name'],
                "locatorHint": f".el-form-item:has-text('{dd['name']}') .el-select__wrapper"
            })
            # Close dropdown with Escape
            send(ws, "Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape"})
            send(ws, "Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape"})
            wait_stable(ws, 400)

    # --- Explore Table Action Buttons ---
    print("\n  [P1] Exploring table action buttons...")

    # Try clicking 导入流水 (import) to see if a modal opens
    import_modal_js = """
(function() {
  var btns = document.querySelectorAll('button');
  var importBtn = Array.from(btns).find(function(b) {
    return (b.textContent||'').includes('导入流水');
  });
  if (importBtn) { importBtn.click(); return true; }
  return false;
})()
"""
    import_clicked = evaluate(ws, import_modal_js)
    wait_stable(ws, 1200)

    if import_clicked:
        interactions += 1
        modal_elements = evaluate(ws, VISIBLE_ELEMENTS_JS)
        modal_info_js = """
(function() {
  var dialog = document.querySelector('.el-dialog, .el-overlay-dialog, [role="dialog"]');
  if (!dialog) return null;
  var title = dialog.querySelector('.el-dialog__title, .el-dialog__header');
  var btns = dialog.querySelectorAll('button');
  var inputs = dialog.querySelectorAll('input, .el-upload');
  return {
    title: (title ? title.textContent : '').trim(),
    buttons: Array.from(btns).map(function(b) { return (b.textContent||'').trim(); }),
    inputs: Array.from(inputs).map(function(i) { return {type: i.type||i.tagName, placeholder: i.placeholder||''}; })
  };
})()
"""
        modal_info = evaluate(ws, modal_info_js)
        if modal_info:
            state_counter += 1
            print(f"  → Modal found: {modal_info.get('title')} | btns: {modal_info.get('buttons')}")
            results["states"].append({
                "stateId": f"S{state_counter}",
                "name": f"Modal - {modal_info.get('title', '导入流水')}",
                "trigger": "click 导入流水",
                "modal": modal_info,
                "elements": [
                    {"role": "button", "text": btn, "locatorHint": f"button:has-text('{btn}')"} for btn in (modal_info.get("buttons") or [])
                ] + [
                    {"role": "textbox", "type": inp.get("type"), "placeholder": inp.get("placeholder")} for inp in (modal_info.get("inputs") or [])
                ]
            })
            results["stateGraph"]["edges"].append({
                "from": "S0",
                "to": f"S{state_counter}",
                "action": "click",
                "element": "导入流水",
                "locatorHint": "button:has-text('导入流水')"
            })
            screenshot(ws, f"home-S{state_counter}-import-modal")
            # Close modal
            close_js = """
(function() {
  var closeBtn = document.querySelector('.el-dialog__close, .el-dialog__headerbtn, button.el-button--text');
  if (!closeBtn) closeBtn = document.querySelector('[aria-label="Close"], .el-overlay-dialog button:last-child');
  if (closeBtn) { closeBtn.click(); return true; }
  return false;
})()
"""
            evaluate(ws, close_js)
            wait_stable(ws, 800)

    # --- Check "到账" button (row action) ---
    print("\n  [P1] Exploring row action buttons...")
    daozhang_js = """
(function() {
  var btns = document.querySelectorAll('.el-table__body button, .el-table .el-button');
  var target = Array.from(btns).find(function(b) {
    var t = (b.textContent||'').trim();
    return t === '到账' || t === '标记';
  });
  if (target) {
    target.click();
    return (target.textContent||'').trim();
  }
  return null;
})()
"""
    dz_clicked = evaluate(ws, daozhang_js)
    wait_stable(ws, 1200)
    if dz_clicked:
        interactions += 1
        modal_info = evaluate(ws, modal_info_js if 'modal_info_js' in dir() else """
(function() {
  var dialog = document.querySelector('.el-dialog, .el-overlay-dialog, [role="dialog"]');
  if (!dialog) return null;
  var title = dialog.querySelector('.el-dialog__title, .el-dialog__header');
  var btns = dialog.querySelectorAll('button');
  return {
    title: (title ? title.textContent : '').trim(),
    buttons: Array.from(btns).map(function(b) { return (b.textContent||'').trim(); })
  };
})()
""")
        if modal_info:
            state_counter += 1
            print(f"  → Action modal: {modal_info.get('title')} | btns: {modal_info.get('buttons')}")
            results["states"].append({
                "stateId": f"S{state_counter}",
                "name": f"Modal - {dz_clicked} action",
                "trigger": f"click {dz_clicked}",
                "modal": modal_info,
                "elements": [
                    {"role": "button", "text": btn, "locatorHint": f".el-dialog button:has-text('{btn}')"} for btn in (modal_info.get("buttons") or [])
                ]
            })
            results["stateGraph"]["edges"].append({
                "from": "S0",
                "to": f"S{state_counter}",
                "action": "click",
                "element": dz_clicked,
                "locatorHint": f".el-table button:has-text('{dz_clicked}')"
            })
            screenshot(ws, f"home-S{state_counter}-{dz_clicked}-modal")
            # Close
            evaluate(ws, """
(function() {
  var closeBtn = document.querySelector('.el-dialog__close, .el-dialog__headerbtn');
  if (!closeBtn) closeBtn = document.querySelector('.el-overlay-dialog .el-button--text');
  if (closeBtn) { closeBtn.click(); return true; }
  // Try cancel button
  var cancelBtn = Array.from(document.querySelectorAll('.el-dialog button')).find(function(b) {
    return (b.textContent||'').includes('取消');
  });
  if (cancelBtn) { cancelBtn.click(); return true; }
  return false;
})()
""")
            wait_stable(ws, 800)

    # --- Take final screenshot ---
    screenshot(ws, "home-S0-final")

    # --- Update stats ---
    results["explorationStats"]["statesDiscovered"] = len(results["states"])
    results["explorationStats"]["interactionsPerformed"] = interactions
    results["explorationStats"]["elementsFound"] = sum(
        len(s.get("elements", [])) for s in results["states"]
    )

    # =========================================================
    # Build full baseline structure
    # =========================================================
    # Enrich State₀ elements with proper locatorHint
    all_s0_elements = state0["elements"]

    # Build the final baseline
    baseline = {
        "schemaVersion": "1.0",
        "slug": "home",
        "pageUrl": "https://fistest.ciwork.cn/",
        "exploredUrl": state0["url"],
        "pageTitle": state0["title"],
        "explorationMode": "full",
        "explorationDate": "2026-06-11",
        "states": results["states"],
        "stateGraph": results["stateGraph"],
        "forms": results["forms"],
        "locatorProfile": {
            "hasTestIds": any(el.get("testId") for el in all_s0_elements),
            "hasAriaLabels": any(el.get("ariaLabel") for el in all_s0_elements),
            "primaryStrategy": "css-class+id" if not any(el.get("testId") for el in all_s0_elements) else "data-testid"
        },
        "explorationStats": results["explorationStats"],
        "screenshots": [
            "home-S0.jpg",
            f"home-S{state_counter}-import-modal.jpg"
        ]
    }

    ws.close()
    print(f"\n=== Exploration Complete ===")
    print(f"  States: {results['explorationStats']['statesDiscovered']}")
    print(f"  Interactions: {results['explorationStats']['interactionsPerformed']}")
    print(f"  Elements: {results['explorationStats']['elementsFound']}")

    return baseline

if __name__ == "__main__":
    result = main()
    output_dir = r"E:\Clark_agent\tests\e2e\test-cases\generated"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "cdp-baseline-home.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\nBaseline written to: {output_path}")
    # Also print summary for inspection
    print("\n=== BASELINE SUMMARY ===")
    print(json.dumps({
        "slug": result["slug"],
        "pageTitle": result["pageTitle"],
        "exploredUrl": result["exploredUrl"],
        "stateCount": len(result["states"]),
        "edgeCount": len(result["stateGraph"]["edges"]),
        "formCount": len(result["forms"]),
        "stats": result["explorationStats"]
    }, ensure_ascii=False, indent=2))
