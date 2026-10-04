# Gateway на Render, frontend на Vercel

## 1. Создать постоянный gateway

1. Откройте https://dashboard.render.com → **New + → Web Service**.
2. Подключите GitHub → выберите **Makarych12/web-sdr** → **Connect**.
3. Заполните поля:

| Поле            | Значение                                       |
| --------------- | ---------------------------------------------- |
| Name            | `ur4mtn-sdr-gateway`                           |
| Branch          | `main`                                         |
| Region          | `Frankfurt`                                    |
| Language        | `Docker`                                       |
| Root Directory  | оставить пустым                                |
| Dockerfile Path | `./Dockerfile`                                 |
| Instance Type   | `Starter` — платный, без засыпания при простое |

4. В **Environment Variables** добавьте `ALLOWED_ORIGINS` со значением `https://web-sdr.vercel.app` — без `/#listen`, без завершающего `/`.
5. В **Advanced** задайте **Health Check Path** = `/api/health`. **Docker Command** оставьте пустым: Dockerfile уже запускает `node server/index.js`. `PORT` Render устанавливает сам.
6. Нажмите **Deploy Web Service** и дождитесь **Live**.
7. Скопируйте HTTPS-адрес, который Render показывает у сервиса. Откройте `<этот адрес>/api/health`: нужен JSON с `ok: true`, `service: "ur4mtn-kiwi-gateway"`, `hosting: "render"`.

Можно также выбрать **New + → Blueprint**, репозиторий `Makarych12/web-sdr`: `render.yaml` уже содержит сервис, Docker, регион, Starter и health check. Введите тот же `ALLOWED_ORIGINS` и подтвердите создание.

## 2. Подключить Vercel

1. Откройте **Vercel → web-sdr → Settings → Environment Variables**.
2. Добавьте **Name** = `VITE_GATEWAY_URL`, **Value** = точный HTTPS-адрес вашего Render-сервиса. Без `/ws`, без `/api`, без `localhost`.
3. Выберите **Production**. Preview включайте только если его точный домен также внесён в `ALLOWED_ORIGINS` на Render (несколько origin — через запятую).
4. Нажмите **Save**, затем **Deployments → последний deployment → ⋯ → Redeploy**.
5. Откройте https://web-sdr.vercel.app, выберите доступный сервер и нажмите «Слушать эфир». Статус `ONLINE` появляется только после реальных PCM и waterfall-пакетов.

Фронтенд обращается к HTTPS `<VITE_GATEWAY_URL>/api/receivers`; звук/спектр идут через WSS `<тот же хост>/ws`. SSL-сертификат и публичный HTTPS/WSS предоставляет Render. Шлюз соединяется с KiwiSDR со своей стороны; Vercel не проксирует поток.

Пустой env на Vercel показывает, что шлюз ещё не подключён, и блокирует запуск вместо бесконечных попыток соединиться с отсутствующим backend. Публичный build с HTTP/localhost gateway завершится ошибкой. Локальная объединённая схема `npm start` продолжает работать на http://localhost:8787.

## 3. Проверить реальный деплой

После **Live** пришлите фактический URL Render. Проверка браузером и Kiwi будет возможна после подключения этого URL. До создания сервиса никакой Render gateway не существует — здесь нет заранее выдуманного адреса.

Из рабочей копии с установленными зависимостями:

```sh
TEST_URL=wss://YOUR_ACTUAL_RENDER_HOST/ws TEST_FILTERS=1 TEST_PAN=1 npm run verify:live
TEST_APP_URL=https://web-sdr.vercel.app npm run verify:sdr
TEST_APP_URL=https://web-sdr.vercel.app npm run verify:ui
TEST_APP_URL=https://web-sdr.vercel.app npm run verify:pwa
```

`YOUR_ACTUAL_RENDER_HOST` замените хостом из Render. Проверки используют реальный эфир: не запускайте несколько одновременно. `verify:sdr` проверяет звук и WF после настройки, AGC, шага 1 Hz, поворота VFO, смены каждого диапазона, фильтра, zoom/pan, жестов и reconnect. Chromium эмулирует ширины 320/390/820/1440 px; физические телефоны этим не проверяются.

## Запуск без Docker (альтернатива)

Если выбрали Language **Node**, Build Command = `npm ci --omit=dev`, Start Command = `node server/index.js`, `NODE_VERSION=22`, остальные поля те же. Vite build шлюзу не нужен. Постоянный диск и база данных не требуются.

Официальные инструкции: https://render.com/docs/docker, https://render.com/docs/websocket, https://render.com/docs/health-checks. Free-сервис засыпает при простое; для постоянного gateway выбран Starter: https://render.com/docs/free.
