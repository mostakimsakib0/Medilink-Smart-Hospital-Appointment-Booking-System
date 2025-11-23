// Small in-browser React bridge (UMD) — no build step required.
// This script detects React/ReactDOM UMD globals and mounts a tiny
// component to the page so developers can progressively enhance
// the existing static pages with React.
(function(){
  if(typeof window === 'undefined') return;
  if(!window.React || !window.ReactDOM) {
    console.warn('React or ReactDOM not found (expected UMD builds).');
    return;
  }
  const e = window.React.createElement;
  const rootId = 'ml-react-root';
  let rootEl = document.getElementById(rootId);
  if(!rootEl){
    rootEl = document.createElement('div');
    rootEl.id = rootId;
    // place root at end of body but before scripts
    document.body.appendChild(rootEl);
  }

  function App(){
    const [now, setNow] = React.useState(new Date().toLocaleTimeString());
    React.useEffect(()=>{
      const t = setInterval(()=> setNow(new Date().toLocaleTimeString()), 1000);
      return ()=> clearInterval(t);
    }, []);

    const user = (function(){
      try{ return JSON.parse(localStorage.getItem('ml_user') || 'null'); }catch(e){ return null; }
    })();

    return e('div', {className: 'ml-react-bridge'},
      e('div', {style:{position:'fixed',right:12,bottom:12,background:'#0b7285',color:'#fff',padding:'8px 10px',borderRadius:8,zIndex:9999,fontSize:13}},
        e('div', null, 'React ready'),
        e('div', {style:{opacity:0.9,fontSize:11}}, user ? `${user.name} · ${user.email}` : 'not signed in'),
        e('div', {style:{opacity:0.8,fontSize:10,marginTop:6}}, `time: ${now}`)
      )
    );
  }

  try{
    // React 18+ createRoot if available
    if(window.ReactDOM.createRoot){
      const root = window.ReactDOM.createRoot(rootEl);
      root.render(e(App));
    } else {
      window.ReactDOM.render(e(App), rootEl);
    }
    console.info('MediLink: React bridge mounted');
  }catch(err){
    console.error('Failed to mount React bridge', err);
  }
})();
