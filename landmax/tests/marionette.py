# Minimal Marionette client: python3 mn.py PORT 'chrome js returning a value'
import socket, json, sys
def rd(s):
    n=b''
    while not n.endswith(b':'): n+=s.recv(1)
    L=int(n[:-1]); d=b''
    while len(d)<L: d+=s.recv(L-len(d))
    return json.loads(d)
s=socket.create_connection(('127.0.0.1',int(sys.argv[1]))); rd(s); i=0
def cmd(name,params):
    global i; i+=1; m=json.dumps([0,i,name,params]).encode(); s.sendall(str(len(m)).encode()+b':'+m); return rd(s)
cmd('WebDriver:NewSession',{'capabilities':{}})
cmd('Marionette:SetContext',{'value':'chrome'})
r=cmd('WebDriver:ExecuteAsyncScript',{'script':sys.argv[2],'args':[],'scriptTimeout':60000})
print(json.dumps(r[2] if r[2] else r[3],indent=1))
