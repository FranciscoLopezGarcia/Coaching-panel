"""Prueba UI sobre laboratorio EXCLUSIVO :5298 -> :3298, nunca sobre :5200.
Solo se permite el dataset guardado en /tmp/base-planilla-pruebas-20261108-785421.sqlite.
La API y Vite de prueba se arrancan según FRONTEND_HANDOFF.md.
"""
import json
from pathlib import Path
from urllib.request import urlopen, Request
from uuid import uuid4
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
BASE='http://127.0.0.1:5298'
DEST=Path('docs/frontend-captures/planilla');DEST.mkdir(parents=True,exist_ok=True)
def api(path):return json.load(urlopen(BASE+'/api/'+path))
identity=api('instance')
expected=json.loads(Path('/tmp/base-planilla-pruebas-20261108-785421.sqlite.instance.json').read_text())
assert identity['fictitious'] and identity['mode']=='laboratory' and identity['datasetId']==expected['datasetId']
assert {(c['key'],c['athleteId']) for c in identity['cases']} == {(c['key'],c['athleteId']) for c in expected['cases']}
athlete=next(c['athleteId'] for c in identity['cases'] if c['key']=='A')
root='athletes/'+athlete+'/'
url=BASE+'/#/athlete/'+athlete+'?cutoff=2026-08-09&from=2026-06-01&to=2026-08-09'
options=Options();options.binary_location='/usr/bin/chromium-browser'
for arg in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=1540,1100']:options.add_argument(arg)
d=webdriver.Chrome(service=Service('/usr/bin/chromedriver'),options=options);w=WebDriverWait(d,30);checks=[]
def body():return d.find_element(By.TAG_NAME,'body').text
def wait(text):w.until(lambda _:text.casefold() in body().casefold())
def click(text,root=None):
 el=next(e for e in (root or d).find_elements(By.TAG_NAME,'button') if e.is_displayed() and e.text.strip()==text)
 d.execute_script('arguments[0].scrollIntoView({block:"center"})',el);el.click()
def cell(label):return d.find_element(By.CSS_SELECTOR,'[aria-label="'+label+'"]')
def edit(label,value):
 el=cell(label);el.send_keys(Keys.CONTROL+'a');el.send_keys(value)
def paste(label,value):
 el=cell(label);d.execute_script("const dt=new DataTransfer();dt.setData('text/plain',arguments[1]);arguments[0].dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));",el,value)
def shot(name,selector):
 el=d.find_element(By.CSS_SELECTOR,selector);d.execute_script('arguments[0].scrollIntoView({block:"start"})',el);d.save_screenshot(str(DEST/(name+'.png')))
def ok(text):checks.append(text);print('OK',text,flush=True)
try:
 d.get(url);wait('SI por movimiento y patrón');w.until(lambda _:len(d.find_elements(By.CSS_SELECTOR,'.overview-main svg'))==3)
 panels=d.find_elements(By.CSS_SELECTOR,'.overview-main > article');assert len({round(x.rect['y']) for x in panels})==1
 assert len(d.find_elements(By.CSS_SELECTOR,'.muscle-grid article'))>=3 and len(d.find_elements(By.CSS_SELECTOR,'.force-grid article'))>=1
 d.find_element(By.CSS_SELECTOR,'button[aria-label="Datos de si"]').click();wait('rts-si-r2');click('×',d.find_element(By.TAG_NAME,'dialog'));ok('Revisión SI obtenida de /tables/si/rts: rts-si-r2')
 shot('graficos-juntos','.analysis-overview');ok('SI, NL y tonelaje a la par; patrones, músculos y fuerza visibles sin cambiar métrica')
 d.find_element(By.CSS_SELECTOR,'.sidebar nav a[href="#/?focus=plantel"]').click();wait('Plantel');w.until(lambda _:'#/athlete/' not in d.current_url)
 w.until(lambda _:d.find_element(By.ID,'plantel').rect['y'] < d.execute_script('return scrollY + innerHeight'))
 ok('Atletas abre y enfoca el plantel desde un perfil')
 d.get(BASE+'/#/');wait('Inicio del coach');d.find_element(By.CSS_SELECTOR,'.sidebar nav a[href="#/?focus=plantel"]').click()
 w.until(lambda _:d.find_element(By.ID,'plantel').rect['y'] < d.execute_script('return scrollY + innerHeight'));ok('Atletas también funciona desde Inicio')
 sessions=api(root+'sessions');session=next(s for s in sessions if s['blockKey']=='A-M1' and s['weekNo']==1)
 original_actual={x['plannedSetId']:x['actual'] for s in sessions for x in s['sets']}
 plan=BASE+'/#/athlete/'+athlete+'?tab=plan&block=A-M1&week=1&context=1&cutoff=2026-08-09'
 d.get(plan);wait('Programar en planilla');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.programming-sheet input'))
 before=cell('Kg · fila 1').get_attribute('value');first_id=d.find_element(By.CSS_SELECTOR,'.programming-sheet tbody tr').get_attribute('data-id')
 edit('Reps máx · fila 1','6');kg_first=str(float(before)+1.5);kg_second=str(float(before)+4);paste('Kg · fila 1',kg_first.replace('.',',')+'\t8.5\n'+kg_second+'\t8');wait('2 series con cambios pendientes');assert float(cell('Kg · fila 1').get_attribute('value') or 0)==float(kg_first)
 cell('Kg · fila 1').send_keys(Keys.ENTER);assert d.switch_to.active_element==cell('Kg · fila 2')
 d.refresh();wait('Programar en planilla');w.until(lambda _:float(cell('Kg · fila 1').get_attribute('value') or 0)==float(kg_first))
 click('Revisar cambios');wait('Publicar cambios de planilla');shot('programacion-planilla','.programming-sheet');click('Publicar cambios de planilla');wait('series publicadas')
 after=api(root+'sessions');assert original_actual=={x['plannedSetId']:x['actual'] for s in after for x in s['sets']}
 d.refresh();wait('Programar en planilla');w.until(lambda _:float(cell('Kg · fila 1').get_attribute('value') or 0)==float(kg_first))
 ok('Pegado Excel, Enter, borrador tras recarga, preview y publicación de dos cambios preservan ejecución')
 # Falla de red después del preview: ninguna operación de publicación llega al servidor.
 edit('Kg · fila 1','128');click('Revisar cambios');wait('Publicar cambios de planilla')
 d.execute_cdp_cmd('Network.enable',{});d.execute_cdp_cmd('Network.setBlockedURLs',{'urls':['*/program']})
 click('Publicar cambios de planilla');wait('las restantes conservan su borrador');assert cell('Kg · fila 1').get_attribute('value')=='128'
 d.execute_cdp_cmd('Network.setBlockedURLs',{'urls':[]});click('Revisar cambios');wait('Publicar cambios de planilla');click('Publicar cambios de planilla');wait('series publicadas');ok('Fallo de red al publicar conserva el borrador y permite revisar y reintentar')
 d.get(BASE+'/#/athlete/'+athlete+'?tab=registro&session='+session['sessionKey']+'&cutoff=2026-08-09');wait('Planilla de registro');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'input[aria-label="Kg reales · fila 1"]'))
 paste('Kg reales · fila 1','123,5\t4\t\n125\t5\t8');assert cell('RPE real · fila 1').get_attribute('value')==''
 click('Marcar filas cargadas como realizadas');d.refresh();wait('Planilla de registro');w.until(lambda _:cell('Kg reales · fila 1').get_attribute('value')=='123.5')
 d.execute_cdp_cmd('Network.setBlockedURLs',{'urls':['*/sets']});click('Guardar registro');wait('Failed to fetch');assert cell('Kg reales · fila 1').get_attribute('value')=='123.5'
 d.execute_cdp_cmd('Network.setBlockedURLs',{'urls':[]});click('Guardar registro');wait('Registro y observaciones guardados');shot('registro-planilla','.data-sheet')
 saved=next(s for s in api(root+'sessions') if s['sessionKey']==session['sessionKey']);assert saved['sets'][0]['actual']['kg']==123.5 and saved['sets'][0]['actual']['rpe'] is None
 d.refresh();wait('Planilla de registro');w.until(lambda _:cell('Kg reales · fila 1').get_attribute('value')=='123.5');ok('Registro tabular, RPE vacío, error/reintento y persistencia al recargar')
 d.get(url);wait('SI por movimiento y patrón');click('Sesión a sesión');w.until(lambda _:'scale=session' in d.current_url);assert len(d.find_elements(By.CSS_SELECTOR,'.overview-main svg'))==3
 # Comparación oficial de series guardadas, con un corte que incluye la fecha efectiva del registro.
 d.get(BASE+'/#/athlete/'+athlete+'?tab=registro&session='+session['sessionKey']+'&cutoff=2026-11-30');wait('Comparar series con lo previsto')
 disclosure=d.find_element(By.CSS_SELECTOR,'.session-response > summary');d.execute_script('arguments[0].scrollIntoView({block:"center"})',disclosure);disclosure.click()
 w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.session-response tbody tr'))
 assert 'fatiga-v2' in d.find_element(By.CSS_SELECTOR,'.session-response').text
 shot('respuesta-series','.session-response');ok('Respuesta oficial fatiga-v2: objetivo, rango y RPE real por serie consultables')
 d.get(url);wait('SI por movimiento y patrón')
 official=next(x for x in d.find_elements(By.CSS_SELECTOR,'.overview-data > summary') if 'Volumen oficial por patrón' in x.text)
 d.execute_script('arguments[0].scrollIntoView({block:"center"})',official);official.click();assert 'patrones-v1' in official.find_element(By.XPATH,'..').text
 ok('Totales oficiales por patrón y convención del backend accesibles')
 d.set_window_size(390,844);shot('graficos-celular','.analysis-overview');assert d.execute_script('return document.documentElement.scrollWidth <= innerWidth');ok('Vista por sesión compartida y celular sin desbordamiento de página')
 d.get(BASE+'/#/athlete/'+athlete+'?tab=registro&session='+session['sessionKey']);wait('Una serie por ficha');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.record-set'));assert d.execute_script('return document.documentElement.scrollWidth <= innerWidth');ok('En celular registro por fichas, con planilla opcional')
 d.set_window_size(1540,1100);d.get(plan);wait('Programar en planilla');click('＋ Sesión');w.until(lambda _:d.find_elements(By.TAG_NAME,'dialog'))
 dialog=d.find_element(By.TAG_NAME,'dialog')
 def header(label,value):
  el=next(x for x in dialog.find_elements(By.TAG_NAME,'label') if x.text.split('\n')[0].strip()==label).find_element(By.TAG_NAME,'input')
  if el.get_attribute('type')=='date':
   d.execute_script("Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(arguments[0],arguments[1]);arguments[0].dispatchEvent(new Event('input',{bubbles:true}));arguments[0].dispatchEvent(new Event('change',{bubbles:true}));",el,value)
  else:el.send_keys(Keys.CONTROL+'a');el.send_keys(value)
 header('Etiqueta de publicación','Prueba planilla ficticia');header('Fecha de inicio','2026-06-06');header('Día de distribución','6')
 def paste_segment(row,text):
  el=dialog.find_element(By.CSS_SELECTOR,'[aria-label="Ejercicio · fila '+str(row)+'"]')
  d.execute_script("const dt=new DataTransfer();dt.setData('text/plain',arguments[1]);arguments[0].dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));",el,text)
 paste_segment(1,'Bench press\t2\t5\t80\t8\tTop set\tBP\tKg fijos')
 dialog.find_element(By.CSS_SELECTOR,'[aria-label="Reps máx · fila 1"]').send_keys('8')
 click('＋ Agregar segmento / ejercicio',dialog);paste_segment(2,'Bench press\t3\t8\t65\t7\tBackoff\tBP\tKg fijos')
 dialog.find_element(By.CSS_SELECTOR,'[aria-label="Reps máx · fila 2"]').send_keys('10')
 before_ids={x['plannedSetId'] for session in api(root+'sessions') for x in session['sets']}
 click('Revisar sesión',dialog);wait('Publicar sesión');shot('crear-sesion-planilla','dialog');click('Publicar sesión',dialog);w.until(lambda _:not d.find_elements(By.TAG_NAME,'dialog'))
 new_sets=[x for session in api(root+'sessions') for x in session['sets'] if x['plannedSetId'] not in before_ids]
 assert len(new_sets)==5 and all(x['actual'] is None for x in new_sets)
 assert [x['protocol']['segment'] for x in new_sets].count('top')==2 and [x['protocol']['segment'] for x in new_sets].count('backoff')==3
 assert {x['protocol']['repsMax'] for x in new_sets}=={8,10}
 ok('Nueva sesión en planilla: rangos 5–8 y 8–10, top/backoff, preview y persistencia sin resultados')
 # Fixture de escritura real, solo en la base exclusiva de prueba: accesorio con patrón oficial.
 def post(path,body):return json.load(urlopen(Request(BASE+'/api/'+root+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST')))
 token=str(uuid4());set_id='pattern-set-'+token
 fixture={'id':set_id,'sessionKey':'pattern-session-'+token,'slotKey':'pattern-slot-'+token,'exerciseName':'Lat pulldown','variantKey':'Lat pulldown','lift':None,'plannedDate':'2026-06-10','blockKey':'pattern-check','weekNo':1,'dayNo':3,'familyKey':'pattern-check','setNo':1,'reps':10,'plannedKg':50,'targetRpe':8,'isWarmup':False}
 operation={'mode':'preview','op':{'type':'add_sets','sets':[fixture]}}
 preview=post('program',operation);post('program',{**operation,'mode':'apply','baseVersionId':preview['baseVersionId']})
 post('sets',{'sets':[{'plannedSetId':set_id,'status':'done','kg':50,'reps':10,'rpe':8,'performedOn':'2026-06-10','pain':None}]})
 d.get(url);wait('SI por movimiento y patrón')
 w.until(lambda _:any('Tracción vertical' in c.text and c.find_elements(By.TAG_NAME,'svg') for c in d.find_elements(By.CSS_SELECTOR,'.pattern-grid article')))
 assert any('Lat pulldown' in c.text for c in d.find_elements(By.CSS_SELECTOR,'.pattern-grid article') if 'Tracción vertical' in c.text)
 ok('Accesorio ubicado automáticamente en tracción vertical con el patrón oficial del backend')
 errors=[e for e in d.get_log('browser') if e['level']=='SEVERE' and 'Failed to fetch' not in e['message'] and 'ERR_BLOCKED_BY_CLIENT' not in e['message']]
 assert not errors, errors
except Exception:
 print('URL', d.current_url, flush=True)
 print(body()[-4500:], flush=True)
 d.save_screenshot(str(DEST/'failure.png'))
 raise
finally:
 (DEST/'checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
 d.quit()
