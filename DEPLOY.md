# Deploy: Dockhand-Stack auf Sleipnir

## Wie der Traffic läuft

`fafnir_tailscale` ist der einzige Container mit eigener Netzwerk-Identität.
`fafnir` selbst joint dessen Network-Namespace (`network_mode: service:fafnir_tailscale`)
und hat daher **keine eigene IP**, die versehentlich exponiert werden könnte — die App
lauscht ausschließlich auf `127.0.0.1:3000` innerhalb dieses gemeinsamen Namespace.
`tailscaled` im Sidecar terminiert HTTPS auf dem Tailnet (Port 443, per `tailscale serve`,
konfiguriert über `TS_SERVE_CONFIG`) und proxied intern auf `127.0.0.1:3000`. Kein
Host-Port-Publish, kein LAN-Zugriff, kein öffentlicher Hostname.

## 1. Neuen Tailscale Auth-Key erzeugen

https://login.tailscale.com/admin/settings/keys → "Generate auth key"

- **Reusable: ja** (Container-Neuerstellung braucht sonst jedes Mal einen neuen Key)
- **Ephemeral: nein** (fafnir soll ein stabiler, dauerhafter Tailnet-Node bleiben)
- **Tags: KEINE** — "Advertise tags" nicht anhaken. Ein Tag, das die ACL nicht kennt,
  hat beim SABnzbd-Setup einen Endlos-Reconnect-Loop verursacht.

Eigener Key pro Dienst — nicht den von SABnzbd/homepage wiederverwenden.

## 2. Stack-Verzeichnis auf Sleipnir anlegen

Analog zur family_app-Konvention:

```
/var/lib/docker/volumes/docker_dockhand_data/_data/stacks/VPS/fafnir/
├── docker-compose.yml          # aus dem Repo-Root kopieren
├── .env                        # aus .env.example, TS_AUTHKEY eintragen
├── data/                       # SQLite-Datei landet hier — Backup = Datei kopieren
└── tailscale/
    ├── state/                  # Tailscale-Node-State (persistent)
    └── config/
        └── serve-config.json   # aus deploy/serve-config.example.json
```

`data/`, `tailscale/state/` und `tailscale/config/` werden beim ersten Start
automatisch von Docker angelegt, wenn sie noch nicht existieren — als root,
da Docker sie anlegt, nicht der Container-Prozess. Der Docker-Entrypoint
(`scripts/docker-entrypoint.sh`) korrigiert die Besitzrechte von `/app/data`
bei jedem Boot selbst, bevor er zum unprivilegierten `nextjs`-User wechselt;
hier ist also kein manuelles `chown` nötig.

`tailscale/config/serve-config.json` dagegen muss **vor dem ersten Start**
existieren (siehe Schritt 3) — ohne sie startet der Tailscale-Sidecar zwar,
proxied aber nichts zur App.

## 3. `serve-config.json` anpassen

`<TAILNET>` in `deploy/serve-config.example.json` durch deine Tailnet-MagicDNS-Suffix
ersetzen (Tailscale Admin Console → DNS-Tab, oder im bestehenden `serve-config.json`
von SABnzbd/homepage nachschauen — gleiches Tailnet, gleiche Domain).

## 4. In Dockhand anlegen

1. Neuen Stack "fafnir" anlegen
2. Inhalt von `docker-compose.yml` einfügen
3. `.env` mit dem neuen `TS_AUTHKEY` hinterlegen
4. `tailscale/config/serve-config.json` mit angepasstem Tailnet-Suffix bereitlegen
5. Stack starten

## 5. Verifizieren

- `docker logs fafnir_tailscale` — sollte den Node erfolgreich im Tailnet zeigen
  (`tailscale status` im Container), kein Reconnect-Loop
- `docker logs fafnir` — sollte `[migrate] applied migrations to ...` zeigen, dann
  den Next.js-Server-Start
- Von einem anderen Tailnet-Gerät: `https://fafnir.<TAILNET>.ts.net` aufrufen

## Offen / noch nicht gebaut

- **Login/Auth** ist im Code noch nicht implementiert (Session-Cookie mit
  Zugangsdaten aus Env-Variablen, siehe Projekt-Briefing). Sobald das steht,
  kommen die entsprechenden Env-Vars (`AUTH_USERNAME`/`AUTH_PASSWORD`/Secret)
  zu `docker-compose.yml`/`.env.example` dazu.
- **Automatisches Redeploy per GitHub Actions** (SSH + `docker compose pull && up`)
  ist in der CI noch nicht aktiv — dafür muss dieser Stack erst einmal existieren.
  Sag Bescheid, dann ergänze ich den Schritt (Muster liegt in family_app bereits vor).
