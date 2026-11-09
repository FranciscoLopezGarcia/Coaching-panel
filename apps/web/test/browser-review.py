"""Smoke sobre API real EN MEMORIA de browser-server.ts; sin seeds o bases compartidas."""
import json,time
from pathlib import Path
from urllib.request import urlopen
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
BASE='http://127.0.0.1:5197'
o=Options();o.binary_location='/usr/bin/chromium-browser'
for arg in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--window-size=1440,1100']:o.add_argument(arg)
d=webdriver.Chrome(service=Service('/usr/bin/chromedriver'),options=o);w=WebDriverWait(d,20)
shots=Path('docs/frontend-captures/ux-v2');shots.mkdir(parents=True,exist_ok=True);checks=[]
def text():return d.find_element(By.TAG_NAME,'body').text
def wait(s):w.until(lambda _:s.casefold() in text().casefold())
def click(s,root=None):
 e=next(x for x in (root or d).find_elements(By.TAG_NAME,'button') if x.is_displayed() and x.text.strip()==s);d.execute_script('arguments[0].scrollIntoView({block:"center"})',e);e.click()
def shot(s,width=1440,height=1100):
 d.set_window_size(width,height);d.execute_script('scrollTo(0,0)');time.sleep(.2);assert not d.execute_script('return document.documentElement.scrollWidth>innerWidth+1');d.save_screenshot(str(shots/(s+'.png')))
def ok(s):checks.append(s);print('OK',s,flush=True)
try:
 a=json.load(urlopen(BASE+'/api/athletes'))[0];assert a['name'].endswith('SINTÉTICO')
 d.get(BASE);wait('Inicio del coach');shot('inicio');d.get(BASE+'/#/athlete/'+a['id']);wait('PROGRAMAR');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.performance-curve svg'));shot('atleta');ok('Inicio, atleta y curva conectada al endpoint real')
 click('Por qué · abrir evidencia →');wait('Registros de soporte');click('×',d.find_element(By.TAG_NAME,'dialog'));ok('Evidencia bajo demanda')
 click('PROGRAMAR\nDistribución y protocolos\n↗') if False else d.find_element(By.CSS_SELECTOR,'.athlete-actions button').click()
 wait('Crear siguiente semana');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.session-column'));shot('semana');click('Crear siguiente semana');dialog=d.find_element(By.TAG_NAME,'dialog');click('Previsualizar diferencias',dialog);wait('Diferencias previstas');click('Guardar borrador',dialog);wait('Borrador guardado');click('×',dialog);ok('Próxima semana: preview y guardado en memoria')
 click('Editar protocolo / consultar anterior');dialog=d.find_element(By.TAG_NAME,'dialog');rep=next(x for x in dialog.find_elements(By.TAG_NAME,'label') if x.text.split('\n')[0]=='Repeticiones').find_element(By.TAG_NAME,'input');rep.send_keys('4');click('Previsualizar diferencias',dialog);wait('Diferencias previstas');rep.send_keys('5');w.until(lambda _:not dialog.find_elements(By.CSS_SELECTOR,'.preview'));click('×',dialog);ok('Edición invalida preview; no publica silenciosamente')
 d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[1].click();wait('Guardar registro');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.record-set'));assert d.find_element(By.CSS_SELECTOR,'.record-set input').is_enabled();shot('registro-mobile',390,1000)
 inp=d.find_element(By.CSS_SELECTOR,'.record-set input');inp.clear();inp.send_keys('125');d.execute_cdp_cmd('Network.enable',{});d.execute_cdp_cmd('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0});click('Guardar registro');wait('Las entradas se conservan');d.execute_cdp_cmd('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1});click('Guardar registro');wait('Registro y observaciones guardados');ok('Registro por IDs de API, móvil y recuperación de red')
 d.set_window_size(1440,1100);d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[2].click();wait('Horizonte');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.observed-dot'));shot('analisis');ok('Análisis: observaciones y proyección separadas')
 click('Historial de macros ↗');wait('Macros');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.macro-card'));shot('macros-tablet',820,1100);ok('Macros y navegación en tablet')
 d.get(BASE+'/#/athlete/'+a['id']+'?tab=plan&block=UI-1&week=12');wait('Crear siguiente semana');w.until(lambda _:d.find_elements(By.CSS_SELECTOR,'.session-column'));d.find_elements(By.CSS_SELECTOR,'.athlete-actions button')[2].click();wait('Análisis');d.back();wait('Crear siguiente semana');assert 'week=12' in d.current_url;ok('Atrás conserva contexto de meso y semana')
finally:
 (shots/'checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n');d.quit()
