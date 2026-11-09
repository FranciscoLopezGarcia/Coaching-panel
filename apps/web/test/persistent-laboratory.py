"""Validación del laboratorio SQLite :5200. Solo modifica un atleta ficticio creado por este test.
Fases: before, offline, after. Los reinicios los controla el operador, no este script.
"""
import json,sys,time
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import unquote
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait,Select
BASE='http://127.0.0.1:5200';dest=Path('docs/frontend-captures/persistente');dest.mkdir(parents=True,exist_ok=True)
o=Options();o.binary_location='/usr/bin/chromium-browser'
for a in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=1440,1100']:o.add_argument(a)
d=webdriver.Chrome(service=Service('/usr/bin/chromedriver'),options=o);w=WebDriverWait(d,25);checks=[]
def get(path):return json.load(urlopen(BASE+'/api/'+path))
def text():return d.find_element(By.TAG_NAME,'body').text
def wait(t):w.until(lambda _:t.casefold() in text().casefold())
def click(t,root=None):
 el=next(x for x in (root or d).find_elements(By.TAG_NAME,'button') if x.is_displayed() and x.text.strip()==t);d.execute_script('arguments[0].scrollIntoView({block:"center"})',el);el.click()
def field(t,v):
 el=next(x for x in d.find_elements(By.TAG_NAME,'label') if x.is_displayed() and x.text.split('\n')[0].strip()==t).find_element(By.CSS_SELECTOR,'input,select,textarea')
 if el.tag_name=='select':Select(el).select_by_visible_text(v)
 else:el.send_keys(Keys.CONTROL+'a');el.send_keys(Keys.BACKSPACE);el.send_keys(v)
 return el

def ok(s):checks.append(s);print('OK',s,flush=True)
def shot(name):d.execute_script('scrollTo(0,0)');d.save_screenshot(str(dest/(name+'.png')))
try:
 phase=sys.argv[1];d.get(BASE)
 if phase=='offline':
  wait('Reintentar');assert 'Elegí un caso' not in text();assert not d.find_elements(By.CSS_SELECTOR,'.lab-cases article');shot('api-no-disponible');ok('API caída: error y reintentar, sin fallback a memoria')
 else:
  identity=get('instance');assert identity['mode']=='laboratory' and identity['fictitious'] is True;assert {c['key'] for c in identity['cases']}==set('ABCDEF');wait('Laboratorio · datos ficticios');wait('LAB-F');w.until(lambda _:len(d.find_elements(By.CSS_SELECTOR,'.lab-cases article'))>=6)
  for case in identity['cases']:
   el=next(x for x in d.find_elements(By.CSS_SELECTOR,'.lab-cases article') if case['name'] in x.text)
   options=el.find_elements(By.TAG_NAME,'option');assert {x['date'] for x in case['cutoffs']}.issubset({x.get_attribute('value') for x in options})
  ok('LAB-A a LAB-F y sus cortes coinciden con el catálogo oficial')
  a=next(x for x in identity['cases'] if x['key']=='A');card=next(x for x in d.find_elements(By.CSS_SELECTOR,'.lab-cases article') if a['name'] in x.text);Select(card.find_element(By.TAG_NAME,'select')).select_by_value('2026-08-09');card.find_element(By.LINK_TEXT,'Abrir caso →').click();wait('Evaluación guardada al 2026-08-09');assert 'cutoff=2026-08-09' in d.current_url;assert 'evaluación pendiente de actualizar' not in text();shot('lab-a-resumen');ok('LAB-A al 2026-08-09: resumen vigente y fecha conservada')
  d.find_element(By.CSS_SELECTOR,'.coach-context > summary').click();click('Por qué · abrir evidencia →');wait('Registros de soporte');assert d.find_elements(By.TAG_NAME,'dialog');shot('lab-a-evidencia');click('×',d.find_element(By.TAG_NAME,'dialog'));ok('Evidencia real de LAB-A')
  d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[0].click();wait('Crear siguiente semana');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.session-column'));assert 'cutoff=2026-08-09' in d.current_url;shot('lab-a-programacion');d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[1].click();wait('Guardar registro');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.record-set'));assert any(x.get_attribute('value') for x in d.find_elements(By.CSS_SELECTOR,'.record-set input[type=number]'));ok('Programación y ejecución de LAB-A consultables por UI')
  d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[2].click();wait('Entrenamiento en números');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.exercise-analysis-detail > summary'));d.find_element(By.CSS_SELECTOR,'.exercise-analysis-detail > summary').click();w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.observed-dot'));assert 'cutoff=2026-08-09' in d.current_url;d.execute_script('arguments[0].scrollIntoView({block:"start"})',d.find_element(By.CSS_SELECTOR,'.performance-panel'));d.save_screenshot(str(dest/'lab-a-curva.png'));ok('Curva con observaciones oficiales y corte conservado')
  if phase=='before':
   d.get(BASE);wait('Crear atleta ficticio propio');click('＋ Crear atleta ficticio propio');name='Prueba persistente '+str(int(time.time()));field('Nombre',name);click('Crear atleta',d.find_element(By.TAG_NAME,'dialog'));wait('Ficticio · '+name);id=unquote(d.current_url.split('/athlete/')[1].split('?')[0]);d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[1].click();wait('Guardar cuestionario')
   for k,v in [('Sueño · 1–10','8'),('Energía · 1–10','7'),('Ganas de entrenar · 1–10','7'),('Estrés · 1–10','3'),('Molestia · 1–10','2')]:field(k,v)
   click('Guardar cuestionario');wait('Cuestionario guardado');click('Actualizar evaluación');wait('Evaluación guardada al');w.until(lambda _:'evaluación pendiente de actualizar' not in text());field('Sueño · 1–10','9');click('Guardar cuestionario');wait('evaluación pendiente');d.refresh();wait('evaluación pendiente');rows=get('athletes/'+id+'/checkins');assert any(x['sleep']==9 for x in rows);assert get('athletes/'+id+'/state')['freshness']['inputsChangedSinceEvaluation'] is True
   (dest/'proof.json').write_text(json.dumps({'datasetId':identity['datasetId'],'athleteId':id,'name':name,'savedSleep':9},indent=2)+'\n');ok('Atleta de prueba separado: modificación guardada, visible tras recarga y evaluación obsoleta')
  elif phase=='after':
   proof=json.loads((dest/'proof.json').read_text());assert identity['datasetId']==proof['datasetId'];id=proof['athleteId'];assert any(x['sleep']==9 for x in get('athletes/'+id+'/checkins'));assert get('athletes/'+id+'/state')['freshness']['inputsChangedSinceEvaluation'] is True;d.get(BASE+'/#/athlete/'+id+'?tab=registro');wait('evaluación pendiente');click('Actualizar evaluación');wait('Evaluación guardada al');w.until(lambda _:'evaluación pendiente de actualizar' not in text());assert get('athletes/'+id+'/state')['freshness']['inputsChangedSinceEvaluation'] is False;ok('Persistencia tras reiniciar API y web: mismo dataset, valor 9 y huella obsoleta; reevaluar la limpia')
except Exception:
 print(text()[-5000:],flush=True);shot('failure-'+sys.argv[1]);raise
finally:
 (dest/(sys.argv[1]+'-checks.json')).write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n');d.quit()
