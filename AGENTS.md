# AGENTS.md - Reglas y Contexto del Proyecto

## 1. Descripción del Proyecto
**IndicAlerts1.0** (cripto-monitor) es una plataforma de monitoreo de mercado de criptomonedas 24/7 con integración de alertas a Telegram y un panel de administración web interactivo.

### Objetivos Principales:
- **Monitoreo Técnico Continuo**: Analiza pares de criptomonedas (Large, Mid y Small Caps) calculando indicadores técnicos (RSI, Tangente RSI, TICK, Medias Móviles, etc.) vía APIs de exchanges como Binance y MEXC.
- **Alertas y Notificaciones Inteligentes**: Envía señales, alertas consolidadas, stickers y audios automáticos a grupos/canales de Telegram configurados.
- **Gestión Multi-Canal**: Monitorea canales de YouTube, integra bots/userbots de Telegram (Python Pyrogram / Node.js) para rastreo de traders y publicación de análisis.
- **Panel Dashboard Control**: Proporciona un servidor Express con interfaz frontend (`dashboard.js`, `ditox.css`) para administrar usuarios, suscripciones, grupos de Telegram, canales de YouTube, traders monitoreados e ideas de análisis técnico.

---

## 2. Arquitectura y Módulos
El proyecto sigue una estructura modular separando la capa de entrada/servidores, base de datos, motor de análisis de mercado, servicios e integraciones externas:

```
IndicAlerts1.0/
├── index.js                  # Punto de entrada principal (orquestación e inyección de dependencias)
├── dashboard.js              # Lógica de cliente / UI JavaScript para el Panel Administrativo Frontend
├── ditox.css                 # Estilos CSS personalizados para la interfaz del Dashboard
├── src/                      # Código fuente del backend y servicios
│   ├── config.js             # Variables de entorno, constantes (símbolos, lapsos, IDs de Telegram)
│   ├── server.js             # Servidor HTTP con Express (Rutas API REST, endpoints administrativos y estáticos)
│   ├── bot.js                # Cliente de Telegram (node-telegram-bot-api), gestión de comandos, audios y stickers
│   ├── api/                  # Clientes de integración con Exchanges
│   │   ├── binance.js        # Obtención de Klines / Velas desde la API de Binance
│   │   └── mexc.js           # Integración con la API de MEXC
│   ├── db/                   # Persistencia de datos
│   │   └── mongo.js          # Conexión a MongoDB (Mongoose) y esquemas (User, TargetGroup, YoutubeChannel, Trader, DitoxIdea)
│   ├── engine/               # Motor de análisis técnico y ciclo principal
│   │   ├── indicators.js     # Cálculo de indicadores cuantitativos (RSI, Tangentes, TICK, etc.)
│   │   └── loop.js           # Bucle periódico de evaluación de mercado y consolidación de alertas
│   ├── services/             # Servicios de soporte e integraciones de terceros
│   │   ├── state.js          # Gestión del estado global en memoria
│   │   ├── traders.js        # Lógica de gestión de traders
│   │   └── youtube.js        # Polling y monitoreo de transcripciones/nuevos videos de YouTube
│   ├── utils/                # Utilidades de formato y ayuda
│   │   └── helpers.js        # Helpers matemáticos y de formateo de texto
│   ├── userbot_setup.py      # Script de autenticación inicial para Userbot de Telegram (Pyrogram)
│   └── userbot_logic.py      # Lógica de recepción y retransmisión del Userbot de Telegram
├── audios.json / stickers.json # Archivos de persistencia JSON local para recursos de Telegram
└── graphify-out/             # Grafo de conocimiento de dependencias y análisis estático (Graphify)
```

### Responsabilidades Clave:
- **`index.js`**: Inicializa la base de datos MongoDB, arranca el bot de Telegram, realiza la inyección de dependencias cíclicas (`setProcesarMercado`), levanta el servidor Express (`src/server.js`), el bucle de mercado (`src/engine/loop.js`) y el servicio de YouTube (`src/services/youtube.js`).
- **`src/server.js`**: Define la API RESTful consumida por el dashboard web para gestionar la configuración en tiempo real, usuarios, traders y grupos destino.
- **`dashboard.js` & `ditox.css`**: Frontend SPA interactivo expuesto por Express para visualizar el estado del mercado, enviar alertas manuales y gestionar la base de datos de subscriptores.
- **`src/engine/`**: Núcleo analítico que evalúa las estrategias y genera disparos de alertas.

---

## 3. Convenciones y Buenas Prácticas

### Lenguajes y Frameworks Detectados:
- **Node.js (>=20.0.0)** con sintaxis CommonJS (`require` / `module.exports`).
- **Express.js** para endpoints web y servidor de estáticos.
- **MongoDB / Mongoose** para la persistencia de usuarios y configuraciones.
- **Python 3** (Pyrogram) para automatización avanzada de Telegram (Userbots).
- **Vanilla JavaScript (ES6+), HTML5 y CSS3** para el Dashboard Frontend.

### Reglas de Estilo y Nombrado:
- **Archivos y Módulos**: Nombrado en *snake_case* o *kebab-case* para archivos internos (`userbot_setup.py`, `clean_index.js`), o simples en minúsculas (`dashboard.js`, `index.js`).
- **Variables y Funciones**: Utilizar `camelCase` para variables y funciones (ej. `evaluarAlertas`, `calcularIndicadores`, `procesarMercado`).
- **Constantes**: Mayúsculas sostenidas `UPPER_SNAKE_CASE` en `src/config.js` (ej. `CHECK_INTERVAL_MS`, `TARGET_GROUP_ID`).

### Manejo de Errores:
- El punto de entrada (`index.js`) incluye handlers globales para `uncaughtException` y `unhandledRejection` para prevenir caídas del servidor por fallos de red/TLS.
- Toda llamada asíncrona a APIs externas (Binance, Telegram, MongoDB) debe estar envuelta en bloques `try/catch` con logs explicativos mediante `console.error`.

### Regla de Oro:
> **No modifiques archivos fuera del alcance de la tarea actual.** Mantén los cambios acotados y específicos al objetivo asignado para preservar la integridad del módulo de mercado en producción.

---

## 4. Uso de Herramientas de Contexto (Graphify)
El proyecto cuenta con un mapa de conocimiento estático generado por Graphify en la carpeta `graphify-out/`.

- **Consulta previa obligatoria**: Antes de modificar funciones, agregar hooks o refactorizar archivos interconectados (como `src/engine/loop.js`, `src/bot.js` o `src/server.js`), consulta siempre el mapa de Graphify localizado en `graphify-out/`.
- **Navegación eficiente**:
  - Si necesitas resolver relaciones entre funciones o archivos, ejecuta `graphify query "<pregunta>"` o `graphify path "<A>" "<B>"`.
  - Si existe `graphify-out/wiki/index.md`, navega por la wiki de arquitectura antes de leer archivos raw masivos.
- **Optimización de tokens**: Usa el grafo de dependencias para identificar únicamente las funciones y módulos directamente afectados, evitando leer todo el código base innecesariamente.
- **Mantenimiento del Grafo**: Tras realizar cambios significativos en el código fuente durante una sesión, ejecuta `graphify update .` para mantener el mapa actualizado.
