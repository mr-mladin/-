# Настройка автосинка VK Ads -> Google Sheets

## Что делает автоматизация
- Каждый день берёт статистику за вчера.
- Читает лист `Сопоставление`.
- Берёт только клиентов со статусом `активно`.
- Пишет в месячный лист только 3 строки:
  - Расход за день
  - Количество переходов
  - Количество заявок

## 1) Подготовь таблицу
В листе `Сопоставление` должны быть заголовки:
- `Клиенты`
- `ID Кабинета`
- `Статус`

## 2) Создай сервисный аккаунт Google
1. Открой Google Cloud Console.
2. Создай проект.
3. Включи `Google Sheets API`.
4. Создай `Service Account`.
5. Создай ключ типа JSON.
6. Скопируй весь JSON (целиком).

## 3) Дай доступ сервисному аккаунту к таблице
- В Google Sheets нажми `Настройки доступа`.
- Добавь email сервисного аккаунта.
- Роль: `Редактор`.

## 4) Заполни GitHub Secrets
Репозиторий -> `Settings` -> `Secrets and variables` -> `Actions` -> `Secrets`

Добавь:
- `VK_ADS_CLIENT_ID`
- `VK_ADS_CLIENT_SECRET`
- `VK_ADS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

`VK_ADS_SPREADSHEET_ID` — это ID из URL таблицы.

## 5) Заполни GitHub Variables (по желанию)
Репозиторий -> `Settings` -> `Secrets and variables` -> `Actions` -> `Variables`

- `VK_ADS_LEADS_FIELD` = `vk.result`
- `VK_ADS_MAPPING_SHEET` = `Сопоставление`
- `VK_ADS_TIMEZONE` = `Europe/Moscow`

## 6) Проверка
- Открой `Actions`.
- Запусти `VK Ads Daily Sync` вручную (`Run workflow`).
- Проверь, что данные записались в лист текущего месяца.

Плановый автозапуск уже включен: каждый день в 07:10 МСК.
