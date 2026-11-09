"""Recorrido de alta y evaluación por UI contra la API de pruebas en memoria (:3127)."""
import json,time
from pathlib import Path
from urllib.request import urlopen
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait,Select
BASE='http://127.0.0.1:5198'
o=Options();o.binary_location='/usr/bin/chromium-browser'
for v in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=1440,1100']:o.add_argument(v)
o.set_capability('goog:loggingPrefs',{'browser':'ALL'})
d=webdriver.Chrome(service=Service('/usr/bin/chromedriver'),options=o);w=WebDriverWait(d,20);checks=[];dest=Path('docs/frontend-captures/laboratorio');dest.mkdir(parents=True,exist_ok=True)
def body():return d.find_element(By.TAG_NAME,'body').text
def wait(t):w.until(lambda _:t.casefold() in body().casefold())
def click(t,root=None):
 e=next(x for x in (root or d).find_elements(By.TAG_NAME,'button') if x.is_displayed() and x.text.strip()==t);d.execute_script('arguments[0].scrollIntoView({block:"center"})',e);e.click()
def field(label,value,root=None):
 e=next(x for x in (root or d).find_elements(By.TAG_NAME,'label') if x.is_displayed() and x.text.split('\n')[0].strip()==label).find_element(By.CSS_SELECTOR,'input,select,textarea')
 if e.tag_name=='select':Select(e).select_by_visible_text(value)
 elif e.get_attribute('type')=='date':
  d.execute_script("Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(arguments[0],arguments[1]);arguments[0].dispatchEvent(new Event('input',{bubbles:true}));arguments[0].dispatchEvent(new Event('change',{bubbles:true}));",e,value)
  assert e.get_attribute('value')==value
 else:
  e.send_keys(Keys.CONTROL+'a');e.send_keys(Keys.BACKSPACE)
  if value:e.send_keys(value)
 return e

def ok(t):checks.append(t);print('OK',t,flush=True)
def dialog():return d.find_element(By.TAG_NAME,'dialog')
try:
 assert all('SINTÉTICO' in a['name'] or 'Ficticio' in a['name'] for a in json.load(urlopen(BASE+'/api/athletes')))
 d.get(BASE);wait('Laboratorio · datos ficticios');wait('Elegí un caso');d.save_screenshot(str(dest/'entrada.png'));click('＋ Crear atleta ficticio propio');name='Recorrido UI '+str(int(time.time()));field('Nombre',name,dialog());click('Crear atleta',dialog());wait('Ficticio · '+name);ok('Entrada identificada y alta ficticia por formulario')
 d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[0].click();wait('Programación');click('＋ Macro');field('Nombre','Macro de prueba',dialog());field('Objetivo','Explorar el recorrido completo',dialog());click('Guardar',dialog());w.until(lambda _:not d.find_elements(By.TAG_NAME,'dialog'));click('＋ Meso');field('Nombre','Meso de prueba',dialog());click('Guardar',dialog());w.until(lambda _:not d.find_elements(By.TAG_NAME,'dialog'));ok('Macro y meso creados y seleccionados sin IDs manuales')
 click('＋ Sesión');field('Etiqueta de publicación','Sesión de prueba',dialog());field('Ejercicio','Squat comp',dialog());field('Series','1',dialog());field('Repeticiones','5',dialog());field('Carga fija · kg','100',dialog());field('RPE objetivo','8',dialog());click('Revisar sesión',dialog());wait('Vista previa calculada por el motor');click('Publicar sesión',dialog());w.until(lambda _:not d.find_elements(By.TAG_NAME,'dialog'));wait('evaluación pendiente');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.session-column'));route=d.current_url;d.refresh();wait('evaluación pendiente');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.session-column'));ok('Semana publicada con preview y persistencia de programación y aviso al recargar')
 click('Crear siguiente semana');click('Previsualizar diferencias',dialog());wait('Diferencias previstas');click('Publicar cambios revisados',dialog());wait('Cambios publicados');click('×',dialog());ok('Duplicación de semana publicada')
 click('Modificar protocolos');field('Repeticiones','6',dialog());click('Previsualizar diferencias',dialog());wait('Diferencias previstas');click('Publicar cambios revisados',dialog());wait('Cambios publicados');click('×',dialog());ok('Protocolo cambiado sin reconstruir distribución')
 d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[1].click();wait('Guardar registro');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.record-set'));first=d.find_element(By.CSS_SELECTOR,'.record-set');field('Carga real · kg','102.5',first);field('Reps reales','6',first);field('RPE real (opcional)','8',first);field('Estado','Realizada',first);d.refresh();wait('Borrador local recuperado');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.record-set'));assert d.find_element(By.CSS_SELECTOR,'.record-set input').get_attribute('value')=='102.5';ok('Borrador de registro recuperado tras recarga')
 d.execute_cdp_cmd('Network.enable',{});d.execute_cdp_cmd('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0});click('Guardar registro');wait('Las entradas se conservan');d.execute_cdp_cmd('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1});click('Guardar registro');wait('Registro y observaciones guardados');wait('evaluación pendiente');field('Sueño · 1–10','8');field('Energía · 1–10','7');field('Ganas de entrenar · 1–10','7');field('Estrés · 1–10','3');field('Molestia · 1–10','2');click('Guardar cuestionario');wait('Cuestionario guardado');ok('Ejecución y cuestionario guardados con recuperación ante fallo de red')
 field('Fecha de análisis',time.strftime('%Y-%m-%d'));click('Actualizar evaluación');wait('Evaluación guardada al '+time.strftime('%Y-%m-%d'));w.until(lambda _:'evaluación pendiente de actualizar' not in body());d.refresh();wait('Evaluación guardada al');assert 'evaluación pendiente de actualizar' not in body();ok('Fecha elegida, evaluación ejecutada y estado actualizado persistente')
 d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[2].click();wait('Análisis');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.performance-panel'));d.set_window_size(390,1000);assert not d.execute_script('return document.documentElement.scrollWidth>innerWidth+1');d.save_screenshot(str(dest/'analisis-mobile.png'));ok('Resultado parcial honesto y análisis móvil sin desborde')
 # Persistencia de protocolo y duplicación: comparar sesiones reales del atleta propio.
 from urllib.parse import unquote
 id=unquote(d.current_url.split('/athlete/')[1].split('?')[0]);sessions=json.load(urlopen(BASE+'/api/athletes/'+id+'/sessions'));assert len(sessions)==2;assert all(x['actual'] is None for s in sessions if s['weekNo']==2 for x in s['sets']);assert any(x['planned']['reps']==6 for s in sessions if s['weekNo']==1 for x in s['sets']);ok('Duplicación sin ejecución y protocolos persistidos por API')
 # Un segundo cliente modifica un registro del corte: la huella del servidor debe invalidar el análisis.
 from urllib.request import Request
 current=next(x for s in sessions for x in s['sets'] if x['actual'] and x['actual']['status']=='done')
 payload={'sets':[{'plannedSetId':current['plannedSetId'],**current['actual'],'kg':103.5}]}
 req=Request(BASE+'/api/athletes/'+id+'/sets',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
 with urlopen(req) as response:assert response.status==200
 d.refresh();wait('evaluación pendiente');click('Actualizar evaluación');wait('Evaluación guardada al '+time.strftime('%Y-%m-%d'));w.until(lambda _:'evaluación pendiente de actualizar' not in body());ok('Cambio de otro cliente detectado por huella y reevaluación limpia el aviso')
 errors=[x for x in d.get_log('browser') if x['level']=='SEVERE' and 'ERR_INTERNET_DISCONNECTED' not in x['message'] and '404' not in x['message']];assert not errors,errors
except Exception:
 print(body()[-4500:],flush=True);d.save_screenshot(str(dest/'failure.png'));raise
finally:
 (dest/'checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n');d.quit()
