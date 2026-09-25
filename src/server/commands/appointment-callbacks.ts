import {
  appointmentConfirmByClient,
  appointmentOfferAltSlots,
  appointmentSelectAltSlot,
} from "@/server/commands/appointments";
import { parseAppointmentCallbackData } from "@/server/channels/telegram";

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text?.slice(0, 200),
        show_alert: false,
      }),
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "telegram.answer_callback_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function handleAppointmentCallback(input: {
  callbackQueryId: string;
  data: string;
}): Promise<{ handled: boolean; message?: string }> {
  const parsed = parseAppointmentCallbackData(input.data);
  if (!parsed) {
    await answerTelegramCallbackQuery(input.callbackQueryId);
    return { handled: false };
  }

  if (parsed.action === "ok") {
    const result = await appointmentConfirmByClient(
      parsed.appointmentId,
      parsed.token,
    );
    const message = result.ok
      ? "Спасибо! Время подтверждено."
      : "Не удалось подтвердить. Напишите куратору.";
    await answerTelegramCallbackQuery(input.callbackQueryId, message);
    return { handled: true, message };
  }

  if (parsed.action === "alt") {
    const result = await appointmentOfferAltSlots(
      parsed.appointmentId,
      parsed.token,
    );
    const message = result.ok
      ? "Выберите время ниже"
      : "Не удалось показать слоты";
    await answerTelegramCallbackQuery(input.callbackQueryId, message);
    return { handled: true, message };
  }

  if (parsed.action === "s" && parsed.slotKey) {
    const result = await appointmentSelectAltSlot(
      parsed.appointmentId,
      parsed.token,
      parsed.slotKey,
    );
    const message = result.ok
      ? "Время обновлено — подтвердите"
      : "Слот недоступен";
    await answerTelegramCallbackQuery(input.callbackQueryId, message);
    return { handled: true, message };
  }

  if (parsed.action === "x") {
    await answerTelegramCallbackQuery(
      input.callbackQueryId,
      "Ок. Можете снова нажать «Другое время» или написать куратору.",
    );
    return { handled: true };
  }

  await answerTelegramCallbackQuery(input.callbackQueryId);
  return { handled: false };
}
