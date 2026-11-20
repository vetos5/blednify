import { useState } from 'react';
import { AccessibilityInfo, TextInput, View } from 'react-native';

import { closeSheet } from '../overlay';
import { makeStyles, radius, space, useColors } from '../theme';
import { PrimaryButton } from './PrimaryButton';
import { Text } from './Text';

export function PromptSheet({
  title,
  initialValue = '',
  placeholder,
  submitLabel = 'Save',
  validate,
  onSubmit,
}: {
  title: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Returns an error to show under the field (the sheet stays open with the text kept), or null when fine. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();
  const submit = () => {
    if (!trimmed) return;
    const problem = validate?.(trimmed) ?? null;
    if (problem) {
      setError(problem);
      AccessibilityInfo.announceForAccessibility(problem);
      return;
    }
    closeSheet();
    onSubmit(trimmed);
  };
  return (
    <View style={styles.root}>
      <Text variant="heading">{title}</Text>
      <TextInput
        value={value}
        onChangeText={(v) => {
          setValue(v);
          setError(null);
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        autoFocus
        selectTextOnFocus
        maxLength={100}
        returnKeyType="done"
        onSubmitEditing={submit}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
        aria-invalid={!!error}
      />
      {error ? (
        <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <PrimaryButton label="Cancel" variant="surface" onPress={closeSheet} style={styles.flex} />
        <PrimaryButton label={submitLabel} onPress={submit} disabled={!trimmed} style={styles.flex} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md, gap: space.lg },
  input: {
    // Grows with the system font size; 52 at 1x.
    minHeight: 52,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  error: { marginTop: -space.sm },
  buttons: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
}));
