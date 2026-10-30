import { userEvent, within } from "storybook/test";

/** Incumbent stories use selectOptions for their native controls. In review the
 * same action opens the actual custom listbox and clicks its option; it never
 * changes a React value directly or bypasses the control's event handler.
 */
export function installReviewInteractions() {
  const original = userEvent.selectOptions;
  userEvent.selectOptions = async (element, values, options) => {
    const wrapper = element.closest?.(".v5-native-select");
    if (!wrapper) return original(element, values, options);
    const native = wrapper.querySelector("select");
    const requested = Array.isArray(values) ? values : [values];
    if (requested.length !== 1) throw new Error("Single-select review requires one option");
    const value = requested[0];
    const option = Array.from(native.options).find((candidate) => candidate.value === String(value) || candidate.textContent === String(value) || candidate === value);
    if (!option) throw new Error(`Review option not found: ${String(value)}`);
    await userEvent.click(wrapper.querySelector('[role="combobox"]'));
    await userEvent.click(within(document.body).getByRole("option", { name: option.textContent, exact: true }));
  };
  return () => { userEvent.selectOptions = original; };
}
