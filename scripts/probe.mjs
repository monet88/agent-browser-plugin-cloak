import fs from 'node:fs';
const LOG = 'F:/CodeBase/web2api/.scratch/plugin_probe.log';
fs.writeFileSync(LOG, `# probe v2 ${new Date().toISOString()}\n`);
let buf = '';
function send(obj){ const s=JSON.stringify(obj); fs.appendFileSync(LOG,`<<< SEND: ${s}\n`); process.stdout.write(s+'\n'); }
process.stdin.on('data', (d) => {
  buf += d.toString(); fs.appendFileSync(LOG, `=== RAW (${d.length}) ===\n${d.toString()}\n`);
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i+1);
    fs.appendFileSync(LOG, `>>> LINE: ${line}\n`);
    let msg; try { msg = JSON.parse(line); } catch(e){ fs.appendFileSync(LOG,`>>> PARSE ERR ${e.message}\n`); continue; }
    fs.appendFileSync(LOG, `>>> MSG type=${msg.type} capability=${msg.capability}\n`);
    const result = { cdpUrl:'http://127.0.0.1:9222', cdp_url:'http://127.0.0.1:9222', connectUrl:'http://127.0.0.1:9222', webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/browser/probe', cleanup:null, metadata:{probe:true}, pid:22169 };
    // try several wrapper shapes
    send({ type:'browser.launch', capability:'browser.provider', protocol:'agent-browser.plugin.v1', response: result });
    // also bare
    send({ type:'browser.launch', result });
    send(result);
  }
});
process.stdin.on('end', ()=>fs.appendFileSync(LOG,`# stdin end\n`));
process.stdin.resume();
setTimeout(()=>{ fs.appendFileSync(LOG,`# timeout exit\n`); process.exit(0); }, 15000);
