# Telegram BotFather — Immigrome

Готовые тексты для брендинга бота. Username **не менять** без необходимости.
Секреты и токены сюда не класть.

## Display name (`/setname`)

```
Immigrome
```

## Description (`/setdescription`, ≤512)

```
Immigrome — сопровождение поступления в вузы Италии.
Напишите вопрос о программах, документах или этапах поступления — сообщение получит куратор и ответит в этом чате.
Мы не оформляем визу и не гарантируем зачисление.
```

## About (`/setabouttext`, ≤120)

```
Immigrome: поступление в Италию. Пишите куратору — ответ здесь.
```

## Commands (`/setcommands`)

```
start - Начать / связаться с Immigrome
help - Что умеет бот сейчас
```

## Avatar (`/setuserpic`)

В репозитории нет готового логотипа Immigrome (в UI — wordmark и цвет `#0071e3`).

Требования к файлу:

- квадрат PNG или JPG, желательно **512×512** или больше;
- читаемый знак Immigrome (wordmark или монограмма) на фирменном синем `#0071e3` или светлом фоне `#fbfbfd`;
- без мелкого текста и водяных знаков; без эмодзи-коллажа.

Загрузите квадратный аватар с wordmark IMMIGROME в BotFather через `/setuserpic`.

## Поведение приложения

- `/start` и первое сообщение в разговоре → одно приветствие через outbox `telegram.send` (если `AUTOMATION_ENABLED=true`).
- `/help` → короткая подсказка через outbox.
- При `AUTOMATION_ENABLED=false` inbound сохраняется, автоответы не ставятся в outbox.

Webhook и worker: см. [deployment/railway-worker.md](deployment/railway-worker.md).
