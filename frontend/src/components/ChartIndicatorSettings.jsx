import { useEffect, useState } from 'react';
import { INDICATOR_GROUPS } from '../utils/chartIndicatorSettings';

function NumberSetting({ field, value, onChange, disabled, label, unit, validPair = () => true }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const number = Number(draft);
  const valid = draft !== '' && Number.isFinite(number) && number >= field.min && number <= field.max
    && Math.abs(number / field.step - Math.round(number / field.step)) < 1e-8 && validPair(number);
  return (
    <label className="indicator-number">
      <span>{field.label}</span>
      <input type="number" min={field.min} max={field.max} step={field.step}
        aria-label={`${label} ${field.label}`} aria-invalid={!valid}
        disabled={disabled} value={draft}
        onChange={(event) => {
          const text = event.target.value;
          const next = Number(text);
          setDraft(text);
          if (text !== '' && next >= field.min && next <= field.max
            && Math.abs(next / field.step - Math.round(next / field.step)) < 1e-8 && validPair(next)) onChange(next);
        }}
        onBlur={() => setDraft(String(value))}
      />
      <span>{field.suffix || `${unit}봉`}</span>
      {!valid && <small role="status">{validPair(number)
        ? `${field.min}~${field.max} 범위로 입력해 주세요.`
        : '짧은 기간은 긴 기간보다 작아야 합니다.'}</small>}
    </label>
  );
}

export default function ChartIndicatorSettings({ settings, onChange, barUnitLabel }) {
  return (
    <div className="indicator-options">
      <p className="indicator-settings-note">
        기간은 선택한 {barUnitLabel}봉 기준입니다. 지표를 켜면 기간을 바꿀 수 있습니다.
      </p>
      {INDICATOR_GROUPS.map((group) => (
        <fieldset className="indicator-group" key={group.label}>
          <legend>{group.label}</legend>
          <div className="indicator-option-grid">
            {group.items.map((item) => {
              const current = settings[item.key];
              const update = (key, value) => onChange(item.key, { ...current, [key]: value });
              return (
                <div key={item.key} className={`indicator-option${current.enabled ? ' selected' : ''}`}>
                  <label className="indicator-toggle">
                    <input type="checkbox" checked={current.enabled}
                      onChange={(event) => update('enabled', event.target.checked)} />
                    <b>{item.name}</b>
                  </label>
                  <p>{item.help}</p>
                  <div className="indicator-fields">
                    {item.fields.map((field) => (
                      <NumberSetting key={field.key} field={field} label={item.name}
                        value={current[field.key]} disabled={!current.enabled} unit={barUnitLabel}
                        validPair={(value) => item.key !== 'macd'
                          || (field.key !== 'fast' || value < current.slow)
                          && (field.key !== 'slow' || value > current.fast)}
                        onChange={(value) => update(field.key, value)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
