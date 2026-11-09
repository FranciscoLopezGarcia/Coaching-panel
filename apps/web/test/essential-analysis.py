"""Comprobación de lectura del análisis esencial. No escribe en la API ni en SQLite.
Requiere el laboratorio documentado en :5200, Selenium y Chromium del sistema.
"""
import json
from pathlib import Path
from urllib.request import urlopen
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select

BASE = 'http://127.0.0.1:5200'
DEST = Path('docs/frontend-captures/esencial')
DEST.mkdir(parents=True, exist_ok=True)
identity = json.load(urlopen(BASE + '/api/instance'))
assert identity['mode'] == 'laboratory' and identity['fictitious']
athlete = next(c['athleteId'] for c in identity['cases'] if c['key'] == 'A')
url = BASE + '/#/athlete/' + athlete + '?cutoff=2026-08-09&from=2026-06-01&to=2026-08-09'
options = Options()
options.binary_location = '/usr/bin/chromium-browser'
for arg in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1100']:
    options.add_argument(arg)
d = webdriver.Chrome(service=Service('/usr/bin/chromedriver'), options=options)
w = WebDriverWait(d, 30)
checks = []

def click(label, root=None):
    el = next(x for x in (root or d).find_elements(By.TAG_NAME, 'button') if x.is_displayed() and x.text.strip() == label)
    d.execute_script('arguments[0].scrollIntoView({block:"center"})', el)
    el.click()

def loaded():
    w.until(lambda _: d.find_elements(By.CSS_SELECTOR, '.exercise-analysis-detail'))
    disclosure = d.find_element(By.CSS_SELECTOR, '.exercise-analysis-detail')
    if not disclosure.get_attribute('open'):
        d.execute_script('arguments[0].scrollIntoView({block:"center"})', disclosure)
        disclosure.find_element(By.TAG_NAME, 'summary').click()
    w.until(lambda _: d.find_elements(By.CSS_SELECTOR, '.essential-analysis table tbody tr'))

def shot(name, element):
    d.execute_script('arguments[0].scrollIntoView({block:"start"})', element)
    d.save_screenshot(str(DEST / (name + '.png')))

try:
    d.get(url)
    loaded()
    root = d.find_element(By.CSS_SELECTOR, '.essential-analysis')
    assert all(t in root.text for t in ['Carga de entrenamiento', 'Volumen por grupo muscular', 'Fuerza · 1RM y e1RM'])
    assert not d.find_element(By.CSS_SELECTOR, '.advanced-analysis').get_attribute('open')
    assert not d.find_element(By.CSS_SELECTOR, '.coach-context').get_attribute('open')
    assert len(root.find_elements(By.CSS_SELECTOR, '.observed-dot')) == 10
    assert 'Proyección condicional' not in root.text
    # Contrasta valores de la tabla con el endpoint oficial, sin recalcular métricas.
    rows = json.load(urlopen(BASE + '/api/athletes/' + athlete + '/weekly?from=2026-06-01&to=2026-08-09&cutoff=2026-08-09'))
    assert next(r for r in rows if r['movement']['exerciseName'] == 'Squat comp')['actual']['nl']['value'] == 15
    assert '15 / 15' in root.text
    click('SI\nrts-aprox-v1', root)
    assert 'SI · rts-aprox-v1' in root.text
    click('Tonelaje\nkg', root)
    click('Ver datos', root)
    w.until(lambda _: d.find_elements(By.TAG_NAME, 'dialog'))
    assert 'sum-reps' in d.find_element(By.TAG_NAME, 'dialog').text
    click('×', d.find_element(By.TAG_NAME, 'dialog'))
    shot('semanas-escritorio', root)
    checks.append('Vista semanal, tres métricas, e1RM histórico y detalle oficial; avanzado cerrado')
    click('Sesión a sesión', root)
    w.until(lambda _: root.find_elements(By.CSS_SELECTOR, '.session-observations details'))
    w.until(lambda _: 'Valores realizados por sesión y variante' in root.text)
    details = root.find_element(By.CSS_SELECTOR, '.session-observations details')
    d.execute_script('arguments[0].open = true', details)
    assert 'prescrito' in details.text.casefold() and 'realizado' in details.text.casefold()
    shot('sesiones-escritorio', root)
    d.refresh()
    loaded()
    assert 'scale=session' in d.current_url and 'cutoff=2026-08-09' in d.current_url
    w.until(lambda _: d.find_elements(By.CSS_SELECTOR, '.session-observations details'))
    checks.append('Métricas oficiales por sesión y variante, series por sesión y selección conservada tras recargar')
    root = d.find_element(By.CSS_SELECTOR, '.essential-analysis')
    click('Singles realizados', root)
    assert 'No hay observaciones comparables' in root.text
    click('e1RM estimado', root)
    assert len(root.find_elements(By.CSS_SELECTOR, '.observed-dot')) == 10
    checks.append('Singles reales separados del e1RM; vacío honesto cuando no hay singles')
    advanced = d.find_element(By.CSS_SELECTOR, '.advanced-analysis')
    d.execute_script('arguments[0].scrollIntoView({block:"start"})', advanced)
    advanced.find_element(By.TAG_NAME, 'summary').click()
    w.until(lambda _: len(d.find_elements(By.CSS_SELECTOR, '.performance-panel')) >= 2)
    checks.append('Análisis avanzado conservado y cargado al desplegar')
    d.find_elements(By.CSS_SELECTOR, '.athlete-actions button')[0].click()
    w.until(lambda _: 'Crear siguiente semana' in d.find_element(By.TAG_NAME, 'body').text)
    assert 'cutoff=2026-08-09' in d.current_url and 'scale=session' in d.current_url
    d.back()
    loaded()
    assert 'scale=session' in d.current_url
    checks.append('Programación y retorno mantienen fecha, período y escala')
    d.set_window_size(390, 844)
    shot('celular', d.find_element(By.CSS_SELECTOR, '.essential-analysis'))
    assert d.execute_script('return document.documentElement.scrollWidth <= window.innerWidth')
    checks.append('Celular de 390 px sin desborde horizontal de página')
    # Falla de red solo en el navegador; no se detienen servidores ni se modifica la BD.
    d.execute_cdp_cmd('Network.enable', {})
    d.execute_cdp_cmd('Network.setBlockedURLs', {'urls': ['*weekly?*']})
    d.refresh()
    w.until(lambda _: d.find_elements(By.CSS_SELECTOR, '.analysis-overview [role=alert]'))
    assert 'Reintentar' in d.find_element(By.CSS_SELECTOR, '.analysis-overview [role=alert]').text
    d.execute_cdp_cmd('Network.setBlockedURLs', {'urls': []})
    click('Reintentar', d.find_element(By.CSS_SELECTOR, '.analysis-overview'))
    loaded()
    checks.append('Error de consulta recuperable con Reintentar; sin datos sintéticos de sustitución')
    e_id = next(c['athleteId'] for c in identity['cases'] if c['key'] == 'E')
    d.get(BASE + '/#/athlete/' + e_id + '?cutoff=2026-08-23&from=2026-06-01&to=2026-08-23&scale=session')
    loaded()
    w.until(lambda _: len(d.find_elements(By.CSS_SELECTOR, '.essential-panel:first-of-type > .table-wrap > table > tbody > tr')) > 0)
    core = json.load(urlopen(BASE + '/api/athletes/' + e_id + '/core?from=2026-06-01&to=2026-08-23&cutoff=2026-08-23&view=sessions'))
    selected = Select(d.find_element(By.CSS_SELECTOR, '.essential-controls select')).first_selected_option.get_attribute('value')
    exercise, variant = json.loads(selected)
    expected = [(session, ex) for session in core['sessions'] for ex in session['exercises'] if ex['exerciseName'] == exercise and ex['variantKey'] == variant]
    w.until(lambda _: len(d.find_elements(By.CSS_SELECTOR, '.essential-panel:first-of-type > .table-wrap > table > tbody > tr')) == len(expected))
    assert len(expected) >= 24
    checks.append('LAB-E: sesiones separadas contrastadas con /core al cambiar de 2 a 3 por semana')
    d_id = next(c['athleteId'] for c in identity['cases'] if c['key'] == 'D')
    d.get(BASE + '/#/athlete/' + d_id + '?cutoff=2026-08-09&from=2026-06-01&to=2026-08-09&scale=session')
    loaded()
    w.until(lambda _: '—' in d.find_element(By.CSS_SELECTOR, '.essential-panel:first-of-type > .table-wrap').text)
    panel = d.find_element(By.CSS_SELECTOR, '.essential-panel:first-of-type')
    assert '15' in panel.text
    click('Ver datos', panel)
    w.until(lambda _: d.find_elements(By.TAG_NAME, 'dialog'))
    assert 'RPE' in d.find_element(By.TAG_NAME, 'dialog').text
    click('×', d.find_element(By.TAG_NAME, 'dialog'))
    checks.append('LAB-D: SI ausente sin rellenar; NL disponible y falta de RPE explicada en detalle')
    print(json.dumps(checks, ensure_ascii=False, indent=2))
except Exception:
    print('URL:', d.current_url, flush=True)
    print(d.find_element(By.TAG_NAME, 'body').text[-5500:], flush=True)
    d.save_screenshot(str(DEST / 'failure.png'))
    raise
finally:
    (DEST / 'checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')
    d.quit()
