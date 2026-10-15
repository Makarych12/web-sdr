import assert from "node:assert/strict";
const steps = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];
export async function selectStep(page, step) {
  const target = steps.indexOf(Number(step));
  assert.notEqual(target, -1, "known tuning step");
  for (let attempts = 0; attempts < steps.length; attempts++) {
    const label = await page
      .getByLabel("Текущий шаг настройки", { exact: true })
      .textContent();
    const [, value, unit] = label.match(/ШАГ:\s*([\d.]+)\s*(kHz|Hz)/);
    const current = steps.indexOf(Number(value) / (unit === "Hz" ? 1000 : 1));
    if (current === target) return;
    await page
      .getByRole("button", {
        name:
          current < target
            ? "Увеличить шаг настройки"
            : "Уменьшить шаг настройки",
        exact: true,
      })
      .evaluate((button) => button.click());
  }
  assert.fail("step control did not reach target");
}
