// Modal text-prompt host for platforms without Alert.prompt (Android).
// Mount once in the root layout; crossAlert routes prompt() calls here.
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { registerPromptHost } from '../../services/util/crossAlert';
import { useTheme } from '../constants/theme';

type Req = { title: string; message?: string; onSubmit: (v: string) => void; onCancel: () => void };

export function CrossPromptHost() {
  const { t } = useTheme();
  const [req, setReq] = useState<Req | null>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    registerPromptHost((r) => { setValue(''); setReq(r); });
    return () => registerPromptHost(null);
  }, []);
  if (!req) return null;
  const close = () => setReq(null);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => { req.onCancel(); close(); }}>
      <KeyboardAvoidingView behavior="padding" style={s.backdrop}>
        <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[s.title, { color: t.text }]}>{req.title}</Text>
          {!!req.message && <Text style={[s.msg, { color: t.textSub }]}>{req.message}</Text>}
          <TextInput
            style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.inputBg }]}
            value={value}
            onChangeText={setValue}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={s.row}>
            <TouchableOpacity style={s.btn} onPress={() => { req.onCancel(); close(); }}>
              <Text style={{ color: t.textSub, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btn} onPress={() => { req.onSubmit(value); close(); }}>
              <Text style={{ color: t.accentText, fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 400, borderRadius: 14, borderWidth: 1, padding: 20, gap: 10 },
  title: { fontSize: 17, fontWeight: '700' },
  msg: { fontSize: 14, lineHeight: 19 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 22, marginTop: 4 },
  btn: { paddingVertical: 6, paddingHorizontal: 4 },
});
