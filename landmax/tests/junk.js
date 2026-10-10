const [url, done] = arguments;
(async () => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const tab = w.gBrowser.addTab("about:blank", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  await new Promise(r => setTimeout(r, 1000));
  const top = tab.linkedBrowser.browsingContext.id;
  let requests = 0, bytes = 0; const hosts = new Set();
  const obs = {
    observe(subject, topic) {
      const ch = subject.QueryInterface(Ci.nsIHttpChannel);
      if (ch.loadInfo?.browsingContextID === undefined) return;
      let bc = BrowsingContext.get(ch.loadInfo.browsingContextID);
      if (!bc || bc.top.id !== top) return;
      if (topic === "http-on-modify-request") { requests++; hosts.add(ch.URI.host); }
      else { try { bytes += Math.max(0, ch.QueryInterface(Ci.nsIHttpChannelInternal) && ch.transferSize || 0); } catch (e) {} }
    },
  };
  Services.obs.addObserver(obs, "http-on-modify-request");
  Services.obs.addObserver(obs, "http-on-stop-request");
  tab.linkedBrowser.loadURI(Services.io.newURI(url), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  await new Promise(r => setTimeout(r, 45000));
  Services.obs.removeObserver(obs, "http-on-modify-request");
  Services.obs.removeObserver(obs, "http-on-stop-request");
  const site = Services.eTLD.getBaseDomainFromHost(Services.io.newURI(url).host);
  const others = [...hosts].filter(h => { try { return Services.eTLD.getBaseDomainFromHost(h) !== site; } catch (e) { return true; } });
  return { requests, megabytes: +(bytes / 1e6).toFixed(1), hosts: hosts.size, otherCompanies: new Set(others.map(h => { try { return Services.eTLD.getBaseDomainFromHost(h); } catch (e) { return h; } })).size };
})().then(done, e => done(String(e)));
