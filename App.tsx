import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Switch, SafeAreaView } from 'react-native';
// ※ファイルの配置場所に合わせてパスは適宜調整してね
import * as DailyModule from './modules/daily-native';

export default function App() {
  // 呼び方と口調のステート管理（初期値は「まさ」「ため口」）
  const [isMasa, setIsMasa] = useState(true);
  const [isCasual, setIsCasual] = useState(true);

  // トグルが切り替わるたびにネイティブ側（Android側）へ設定を送信
  useEffect(() => {
    const name = isMasa ? "まさ" : "あなた";
    const tone = isCasual ? "ため口" : "敬語";
    
    // ネイティブモジュールを呼び出し
    if (DailyModule && DailyModule.updateAiSettings) {
      DailyModule.updateAiSettings(name, tone);
    }
  }, [isMasa, isCasual]);

  return (
    <SafeAreaView style={styles.container}>
      {/* 設定パネル */}
      <View style={styles.settingsPanel}>
        <Text style={styles.title}>AI アシスタント設定</Text>
        
        <View style={styles.settingRow}>
          <Text style={styles.label}>呼び方: {isMasa ? "まさ" : "あなた"}</Text>
          <Switch value={isMasa} onValueChange={setIsMasa} />
        </View>
        
        <View style={styles.settingRow}>
          <Text style={styles.label}>口調: {isCasual ? "ため口" : "敬語"}</Text>
          <Switch value={isCasual} onValueChange={setIsCasual} />
        </View>
      </View>

      {/* ここから下に既存のチャットUIなどを配置 */}
      <View style={styles.mainArea}>
        <Text>チャット画面などのメインコンテンツ</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  settingsPanel: {
    padding: 20,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    margin: 16,
    elevation: 4, // Android用のドロップシャドウ
    shadowColor: '#000', // iOS用のドロップシャドウ
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
    color: '#333',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 10,
  },
  label: {
    fontSize: 16,
    color: '#555',
  },
  mainArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  }
});
