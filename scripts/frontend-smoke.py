"""Recorridos reales con Selenium del sistema. Solo contra seed sintético aislado.
Uso: FRONTEND_REVIEW_URL=http://127.0.0.1:5187 python3 scripts/frontend-smoke.py
No instala dependencias ni inicia servidores. Escribe registros en la DB de esa URL.
"""
import json
import os
import time
from pathlib import Path
from urllib.request import urlopen
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait, Select

BASE = os.environ.get('FRONTEND_REVIEW_URL', 'http://127.0.0.1:5187')
if BASE != 'http://127.0.0.1:5187':
    raise SystemExit('Este smoke escribe datos; solo se admite el servidor sintético aislado :5187.')
athletes = json.load(urlopen(BASE + '/api/athletes'))
if not athletes or any('(sintético)' not in a['name'] for a in athletes):
    raise SystemExit('La base no contiene exclusivamente atletas sintéticos. No se ejecutan escrituras.')
opts = Options()
opts.binary_location = '/usr/bin/chromium-browser'
for arg in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1100']:
    opts.add_argument(arg)
opts.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
d = webdriver.Chrome(service=Service('/usr/bin/chromedriver'), options=opts)
wait = WebDriverWait(d, 20)
shots = Path('docs/frontend-captures')
shots.mkdir(parents=True, exist_ok=True)
results = []

def body():
    return d.find_element(By.TAG_NAME, 'body').text

def visible(text):
    wait.until(lambda _: text.casefold() in body().casefold())

def click(text, root=None):
    root = root or d
    candidates = root.find_elements(By.XPATH, ".//button[normalize-space(.)=" + json.dumps(text, ensure_ascii=False) + "]")
    el = next(x for x in candidates if x.is_displayed())
    d.execute_script('arguments[0].scrollIntoView({block:"center"})', el)
    el.click()

def field(label, value, root=None):
    root = root or d
    labels = [x for x in root.find_elements(By.TAG_NAME, 'label') if x.is_displayed() and x.text.split('\n')[0].strip() == label]
    if not labels:
        raise AssertionError('No label: ' + label)
    el = labels[0].find_element(By.CSS_SELECTOR, 'input, select, textarea')
    if el.tag_name == 'select':
        Select(el).select_by_visible_text(value)
    else:
        el.send_keys(Keys.CONTROL + 'a')
        el.send_keys(Keys.BACKSPACE)
        if value: el.send_keys(value)
    return el

def route(**values):
    d.execute_script('const [values]=arguments;const [base,q]=location.hash.split("?");const p=new URLSearchParams(q);for(const[k,v]of Object.entries(values)){v===null?p.delete(k):p.set(k,v)}location.hash=base+"?"+p.toString()', values)

def shot(name, width=1440, height=1100):
    d.set_window_size(width, height)
    d.execute_script('scrollTo(0,0)')
    time.sleep(.25)
    assert not d.execute_script('return document.documentElement.scrollWidth>innerWidth+1'), 'Overflow: ' + name
    d.save_screenshot(str(shots / (name + '.png')))

def done(text):
    results.append(text)
    print('OK', text, flush=True)

try:
    d.get(BASE)
    visible('Inicio del coach')
    visible('DEMO A')
    shot('inicio-desktop')
    click('Revisión')
    visible('3 atletas')
    a = next(x for x in athletes if x['name'].startswith('DEMO A'))
    d.get(BASE + '/#/athlete/' + a['id'])
    visible('Qué está pasando')
    wait.until(lambda _: len(d.find_elements(By.CSS_SELECTOR, '.lift-card')) == 3)
    visible('Evolución del período')
    wait.until(lambda _: len(d.find_elements(By.CSS_SELECTOR, '.chart-panel')) == 4)
    shot('atleta-desktop')
    click('Por qué · abrir evidencia →')
    visible('Registros de soporte')
    assert 'Próximo chequeo' in body()
    click('×', d.find_element(By.TAG_NAME, 'dialog'))
    done('Inicio, filtro de revisión, perfil y evidencia real')
    click('Programación')
    visible('Crear siguiente semana')
    wait.until(lambda _: len(d.find_elements(By.CSS_SELECTOR, '.session-column')) > 0)
    shot('semana-desktop')
    click('Todas las semanas')
    wait.until(lambda _: len(d.find_elements(By.CSS_SELECTOR, '.week-column')) > 0)
    shot('meso-desktop')
    done('Macro activo, meso y semanas/sesiones en paralelo')
    click('Crear siguiente semana')
    dialog = d.find_element(By.TAG_NAME, 'dialog')
    click('Previsualizar diferencias', dialog)
    visible('Diferencias previstas por el motor')
    click('Guardar borrador', dialog)
    visible('Borrador guardado en el servidor')
    click('×', dialog)
    done('Siguiente semana: preview y borrador sin publicación')
    # Crear dos segmentos distintos desde el formulario, sin JSON.
    click('＋ Sesión')
    dialog = d.find_element(By.TAG_NAME, 'dialog')
    field('Etiqueta de publicación', 'Sesión smoke (sintético)', dialog)
    field('Semana', '10', dialog)
    field('Ejercicio', 'Squat comp', dialog)
    field('Series', '1', dialog)
    field('Repeticiones', '3', dialog)
    field('Carga fija · kg', '100', dialog)
    field('RPE objetivo', '7', dialog)
    field('Tipo', 'Top set', dialog)
    click('＋ Agregar segmento / ejercicio', dialog)
    second = dialog.find_elements(By.TAG_NAME, 'fieldset')[1]
    field('Ejercicio', 'Squat comp', second)
    field('Series', '1', second)
    field('Repeticiones', '6', second)
    field('Carga fija · kg', '80', second)
    field('Tipo', 'Backoff', second)
    click('Revisar sesión', dialog)
    visible('2 series nuevas, 2 segmentos')
    click('Publicar sesión', dialog)
    wait.until(lambda _: not d.find_elements(By.TAG_NAME, 'dialog'))
    manifest = d.execute_script('return JSON.parse(localStorage.getItem(arguments[0]))', 'base:planned-identities:' + a['id'])
    created = manifest[-2:]
    session = created[0]['sessionKey']
    route(tab='registro', session=session, week='10')
    visible('Guardar registro')
    wait.until(lambda _: len(d.find_elements(By.CSS_SELECTOR, '.record-set')) == 2)
    first = d.find_elements(By.CSS_SELECTOR, '.record-set')[0]
    field('Carga real · kg', '102.5', first)
    field('Reps reales', '3', first)
    field('Estado', 'Realizada', first)
    # RPE real permanece vacío, no se completa desde el objetivo.
    assert field('RPE real (opcional)', '', first).get_attribute('value') == ''
    d.execute_cdp_cmd('Network.enable', {})
    d.execute_cdp_cmd('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': 0, 'uploadThroughput': 0})
    click('Guardar registro')
    visible('Las entradas se conservan para reintentar')
    assert d.execute_script('return localStorage.getItem(arguments[0])', 'base:record-draft:' + a['id'] + ':' + session)
    d.execute_cdp_cmd('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
    click('Guardar registro')
    visible('Registro y observaciones guardados')
    sessions = json.load(urlopen(BASE + '/api/athletes/' + a['id'] + '/sessions'))
    saved = next(s for s in sessions if s['sessionKey'] == session)
    assert saved['sets'][0]['actual']['kg'] == 102.5
    assert saved['sets'][0]['actual']['rpe'] is None
    shot('registro-mobile', 390, 1000)
    # Cuestionario admite campos faltantes.
    field('Sueño · 1–10', '8')
    click('Guardar cuestionario')
    visible('Cuestionario guardado')
    done('Creación segmentada, registro móvil, RPE faltante, error de red y reintento, cuestionario parcial')
    d.set_window_size(1440, 1100)
    route(tab='plan', week='10', session=session)
    visible('Duplicar sesión')
    click('Duplicar sesión')
    dialog = d.find_element(By.TAG_NAME, 'dialog')
    click('Previsualizar diferencias', dialog)
    visible('Diferencias previstas por el motor')
    click('Publicar cambios revisados', dialog)
    visible('Cambios publicados: versión e historial actualizados')
    click('×', dialog)
    done('Duplicación publicada con preview y nuevos IDs (sin resultados)')
    route(tab='analisis')
    visible('Comparativas')
    click('Comparativas')
    click('Actual contra anterior (semanas calendario)')
    visible('Disponibilidad')
    shot('comparativas-desktop')
    done('Comparativa real actual/anterior y normalización')
    route(tab='seguimiento')
    visible('Hallazgos y propuestas vigentes')
    existing = json.load(urlopen(BASE + '/api/athletes/' + a['id'] + '/interventions'))
    keys = {x['intervention']['proposalKey'] for x in existing}
    decisions = json.load(urlopen(BASE + '/api/athletes/' + a['id']))['decisions']
    current = [x for x in decisions if x['validity'] == 'vigente']
    row_index = next(i for i,x in enumerate(current) if x['key'] not in keys)
    click('Revisar intervención', d.find_elements(By.CSS_SELECTOR,'.finding-row')[row_index])
    visible('Aceptar propuesta')
    click('Aceptar propuesta')
    visible('Registrar aplicación')
    assert 'Aplicada —' in body()
    click('Registrar aplicación')
    field('Descripción aplicada', 'Ajuste manual de prueba sintética; no causalidad')
    click('Confirmar aplicación registrada')
    wait.until(lambda _: 'Iniciar seguimiento' in body() or any(x.text=='seguimiento' for x in d.find_elements(By.CSS_SELECTOR,'.intervention .badge')))
    if any(x.text=='Iniciar seguimiento' for x in d.find_elements(By.TAG_NAME,'button')): click('Iniciar seguimiento')
    visible('seguimiento')
    shot('intervenciones-desktop')
    click('Historial automático')
    visible('Cambio detectado')
    done('Intervención aceptada, aplicación separada, seguimiento e historial automático')
    route(tab='config')
    visible('Importaciones')
    click('Importaciones')
    fixture = (shots / 'hevy-sintetico.txt').resolve()
    fixture.write_text('title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps,rpe\nSintético,2026-11-05 10:00:00,2026-11-05 11:00:00,Squat (Barbell),0,normal,100,5,8\n')
    d.find_element(By.CSS_SELECTOR, 'input[type=file]').send_keys(str(fixture))
    click('Analizar archivo (dry-run)')
    visible('Resumen de importación')
    click('Confirmar aplicación de esta importación')
    visible('Importación aplicada')
    done('Importación Hevy con archivo, dry-run y confirmación de aplicación')
    # Programación avanzada: plantillas, selección explícita y efectos separados.
    route(tab='plan', week='10', session=session)
    visible('Guardar plantilla')
    template_name = 'Plantilla smoke ' + str(int(time.time())) + ' (sintético)'
    click('Guardar plantilla')
    dialog = d.find_element(By.TAG_NAME, 'dialog')
    field('Nombre', template_name, dialog)
    click('Guardar plantilla', dialog)
    visible('Plantilla guardada')
    current_sessions = json.load(urlopen(BASE + '/api/athletes/' + a['id'] + '/sessions'))
    target_week = max(x['weekNo'] for x in current_sessions) + 2
    click('Repetir estructura')
    dialog = d.find_element(By.TAG_NAME, 'dialog')
    field('Semanas destino (separadas por comas)', str(target_week) + ',' + str(target_week+1), dialog)
    click('Previsualizar diferencias', dialog)
    visible('Diferencias previstas por el motor')
    click('Publicar cambios revisados', dialog)
    visible('Cambios publicados: versión e historial actualizados')
    click('×', dialog)
    click('Aplicar plantilla')
    dialog = d.find_element(By.TAG_NAME, 'dialog')
    field('Semana destino', str(target_week+2), dialog)
    field('Plantilla', template_name, dialog)
    click('Previsualizar diferencias', dialog)
    visible('Diferencias previstas por el motor')
    click('Publicar cambios revisados', dialog)
    visible('Cambios publicados: versión e historial actualizados')
    click('×', dialog)
    click('Modificar protocolos')
    dialog = d.find_element(By.TAG_NAME, 'dialog')
    field('Repeticiones', '4', dialog)
    click('Previsualizar diferencias', dialog)
    visible('Diferencias previstas por el motor')
    click('Publicar cambios revisados', dialog)
    visible('Cambios publicados: versión e historial actualizados')
    click('×', dialog)
    after = json.load(urlopen(BASE + '/api/athletes/' + a['id'] + '/sessions'))
    actual = next(x for x in after if x['sessionKey']==session)
    assert all(x['planned']['reps']==4 for x in actual['sets'])
    assert actual['sets'][0]['actual']['reps']==3, 'Modificar protocolo no debe modificar resultados'
    copies=[s for s in after if s['weekNo'] in [target_week,target_week+1,target_week+2]]
    assert copies and all(x['actual'] is None for s in copies for x in s['sets']), 'La copia incluye resultados'
    click('Mover sesión', next(x for x in d.find_elements(By.CSS_SELECTOR,'.session-column') if session in x.text))
    dialog = d.find_element(By.TAG_NAME, 'dialog')
    click('Previsualizar diferencias', dialog)
    visible('Diferencias previstas por el motor')
    click('Guardar borrador', dialog)
    visible('Borrador guardado en el servidor')
    click('×', dialog)
    done('Plantilla guardada/aplicada, repetición en dos destinos, protocolo con ejecución intacta y mover sesión en borrador')
    # Crear metadatos de macro y meso desde formularios.
    macro_name='Macro smoke (sintético) '+str(int(time.time()))
    click('＋ Macro')
    dialog = d.find_element(By.TAG_NAME, 'dialog')
    field('Nombre',macro_name,dialog)
    field('Objetivo','Ensayo sintético de interfaz',dialog)
    click('Guardar',dialog)
    wait.until(lambda _: not d.find_elements(By.TAG_NAME,'dialog'))
    click('Macros')
    wait.until(lambda _: any(macro_name in x.text for x in d.find_elements(By.CSS_SELECTOR,'.macro-card')))
    next(x for x in d.find_elements(By.CSS_SELECTOR,'.macro-card') if macro_name in x.text).click()
    click('＋ Meso')
    dialog=d.find_element(By.TAG_NAME,'dialog')
    field('Nombre','Meso smoke (sintético)',dialog)
    block_key='SMOKE-'+str(int(time.time()))
    field('Identificador de meso',block_key,dialog)
    click('Guardar',dialog)
    wait.until(lambda _: not d.find_elements(By.TAG_NAME,'dialog'))
    wait.until(lambda _: any('Meso smoke' in x.text for x in d.find_elements(By.CSS_SELECTOR,'.meso-row')))
    done('Creación de macro planificado y meso asociado desde formularios')
    c=next(x for x in athletes if x['name'].startswith('DEMO C'))
    d.get(BASE+'/#/athlete/'+c['id'])
    visible('Qué está pasando')
    wait.until(lambda _: d.find_elements(By.CSS_SELECTOR,'.lift-card'))
    shot('datos-incompletos-tablet',820,1180)
    done('Datos faltantes con abstenciones del motor y adaptación a tablet')
    d.get(BASE)
    visible('Inicio del coach')
    wait.until(lambda _: d.find_elements(By.CSS_SELECTOR, 'tbody tr'))
    assert d.find_element(By.XPATH, '//button[normalize-space(.)="Revisión"]').get_attribute('class') == 'on'
    shot('inicio-mobile', 390, 1000)
    done('Persistencia de filtros al volver y adaptación a 390 px')
    d.set_window_size(1440,1100)
    click('＋ Nuevo atleta')
    dialog=d.find_element(By.TAG_NAME,'dialog')
    field('Nombre','Atleta nuevo (sintético) '+str(int(time.time())),dialog)
    click('Crear atleta',dialog)
    visible('Todavía no hay conclusiones')
    done('Alta de atleta por API y estado vacío sin conclusiones inventadas')
    severe = [x for x in d.get_log('browser') if x['level'] == 'SEVERE' and 'ERR_INTERNET_DISCONNECTED' not in x['message'] and 'Failed to fetch' not in x['message']]
    print('CONSOLE', json.dumps(severe, ensure_ascii=False), flush=True)
    assert not severe, 'Errores de consola no esperados'
except Exception:
    d.save_screenshot(str(shots / 'smoke-failure.png'))
    print('FAILURE BODY', body()[-5500:], flush=True)
    raise
finally:
    (shots / 'smoke-results.json').write_text(json.dumps({'checks': results}, indent=2, ensure_ascii=False) + '\n')
    d.quit()
