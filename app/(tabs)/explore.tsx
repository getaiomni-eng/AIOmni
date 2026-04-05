import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from '../../services/ai';
import { C, F, SP, SZ } from '../constants/tokens';

type NewsItem = {
  id: string;
  title: string;
  summary: string;
  source: string;
  timestamp: string;
  category: 'trade' | 'injury' | 'analysis' | 'draft';
};

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  rank: number;
};

// Mock news data
const MOCK_NEWS: NewsItem[] = [
  {
    id: '1',
    title: 'Mahomes Extension Creates Dynasty Ripple Effects',
    summary: 'Chiefs QB\'s new deal impacts trade values across the league...',
    source: 'ESPN',
    timestamp: '2h ago',
    category: 'trade',
  },
  {
    id: '2',
    title: 'CMC Injury Update: Expected Timeline Revealed',
    summary: 'Panthers RB could return sooner than expected...',
    source: 'NFL.com',
    timestamp: '4h ago',
    category: 'injury',
  },
  {
    id: '3',
    title: '2025 Rookie Class Power Rankings',
    summary: 'Top prospects and their fantasy football implications...',
    source: 'CBS Sports',
    timestamp: '6h ago',
    category: 'draft',
  },
];

const TRENDING_PLAYERS: Player[] = [
  { id: '4046', name: 'Christian McCaffrey', position: 'RB', team: 'SF', rank: 1 },
  { id: '6786', name: 'CeeDee Lamb', position: 'WR', team: 'DAL', rank: 2 },
  { id: '7564', name: 'Tyreek Hill', position: 'WR', team: 'MIA', rank: 3 },
  { id: '4866', name: 'Justin Jefferson', position: 'WR', team: 'MIN', rank: 4 },
  { id: '6770', name: "Ja'Marr Chase", position: 'WR', team: 'CIN', rank: 5 },
];

function PlayerPhoto({ playerId, size = 40 }: { playerId: string; size?: number }) {
  const [err, setErr] = useState(false);
  const s = { width: size, height: size, borderRadius: size / 2 };
  if (!err && playerId) {
    return (
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }}
        style={[s, { backgroundColor: 'rgba(255,255,255,0.9)' }]}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={[s, { backgroundColor: C.sageS, alignItems:'center', justifyContent:'center', borderWidth:1.5, borderColor: 'rgba(88,131,191,0.18)' }]}>
      <Text style={{ fontSize: size * 0.35, color: C.dim2 }}>?</Text>
    </View>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const categoryColors = {
    trade: C.blueDeep,
    injury: '#dc2626',
    analysis: C.gold,
    draft: C.mint,
  };

  return (
    <TouchableOpacity style={styles.newsCard}>
      <View style={styles.newsCardShine} />
      <View style={styles.newsHeader}>
        <View style={[styles.categoryBadge, { backgroundColor: categoryColors[item.category] }]}>
          <Text style={styles.categoryText}>{item.category.toUpperCase()}</Text>
        </View>
        <Text style={styles.newsSource}>{item.source}</Text>
      </View>
      <Text style={styles.newsTitle}>{item.title}</Text>
      <Text style={styles.newsSummary}>{item.summary}</Text>
      <Text style={styles.newsTime}>{item.timestamp}</Text>
    </TouchableOpacity>
  );
}

function TrendingPlayer({ player }: { player: Player }) {
  return (
    <TouchableOpacity style={styles.trendingPlayer}>
      <View style={styles.trendingPlayerShine} />
      <PlayerPhoto playerId={player.id} size={48} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.trendingName}>{player.name}</Text>
        <Text style={styles.trendingSub}>{player.team} · {player.position}</Text>
      </View>
      <Text style={styles.trendingRank}>#{player.rank}</Text>
    </TouchableOpacity>
  );
}

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [news, setNews] = useState<NewsItem[]>(MOCK_NEWS);
  const [trending, setTrending] = useState<Player[]>(TRENDING_PLAYERS);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'news' | 'players' | 'search'>('news');

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const prompt = `You are AIOmni, fantasy football expert. User searched: "${searchQuery}". Provide a brief, insightful response about this player, team, or topic in fantasy football context. Keep under 100 words.`;
      const response = await askAI(prompt, 150);
      // In a real app, this would show results or navigate
      alert(`AI Insight: ${response}`);
    } catch (e) {
      alert('Could not search. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>🔍 Explore</Text>
      </View>

      <View style={styles.tabBar}>
        {[
          { key: 'news', label: 'News' },
          { key: 'players', label: 'Trending' },
          { key: 'search', label: 'Search' },
        ].map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setActiveTab(tab.key as any)}
            style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnOn]}
          >
            <Text style={[styles.tabTxt, activeTab === tab.key && styles.tabTxtOn]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'news' && (
        <FlatList
          data={news}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <NewsCard item={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {activeTab === 'players' && (
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>🔥 Trending Players</Text>
          <FlatList
            data={trending}
            keyExtractor={item => item.id}
            renderItem={({ item }) => <TrendingPlayer player={item} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}

      {activeTab === 'search' && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search players, teams, or topics..."
            placeholderTextColor={C.dim2}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity
            style={[styles.searchBtn, (!searchQuery.trim() || loading) && styles.searchBtnDisabled]}
            onPress={handleSearch}
            disabled={!searchQuery.trim() || loading}
          >
            {loading ? (
              <ActivityIndicator color={C.ink} size="small" />
            ) : (
              <Text style={styles.searchBtnText}>Search</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SP[3],
    paddingBottom: 12,
  },
  title: {
    fontSize: SZ.xl,
    fontFamily: F.bold,
    color: '#ffffff',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: SP[3],
    paddingBottom: 12,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabBtnOn: {
    backgroundColor: '#ffffff',
  },
  tabTxt: {
    fontSize: SZ.sm,
    fontFamily: F.mono,
    color: '#ffffff',
  },
  tabTxtOn: {
    color: C.ink,
    fontFamily: F.bold,
  },
  list: {
    paddingHorizontal: SP[3],
    paddingBottom: 100,
  },
  sectionTitle: {
    fontSize: SZ.lg,
    fontFamily: F.bold,
    color: '#ffffff',
    paddingHorizontal: SP[3],
    paddingBottom: 12,
  },
  newsCard: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.18)',
    position: 'relative',
    overflow: 'hidden',
  },
  newsCardShine: {
    position: 'absolute',
    top: 0,
    left: '8%',
    right: '8%',
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.95)',
    zIndex: 6,
  },
  newsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: SZ.xs,
    fontFamily: F.mono,
    color: '#ffffff',
    letterSpacing: 1,
  },
  newsSource: {
    fontSize: SZ.xs,
    fontFamily: F.mono,
    color: C.dim2,
  },
  newsTitle: {
    fontSize: SZ.sm,
    fontFamily: F.bold,
    color: C.ink,
    marginBottom: 6,
    lineHeight: 20,
  },
  newsSummary: {
    fontSize: SZ.sm,
    color: C.dim,
    lineHeight: 18,
    marginBottom: 8,
  },
  newsTime: {
    fontSize: SZ.xs,
    fontFamily: F.mono,
    color: C.dim2,
  },
  trendingPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.18)',
    position: 'relative',
    overflow: 'hidden',
  },
  trendingPlayerShine: {
    position: 'absolute',
    top: 0,
    left: '8%',
    right: '8%',
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.95)',
    zIndex: 6,
  },
  trendingName: {
    fontSize: SZ.sm,
    fontFamily: F.bold,
    color: C.ink,
  },
  trendingSub: {
    fontSize: SZ.xs,
    fontFamily: F.mono,
    color: C.dim2,
    marginTop: 2,
  },
  trendingRank: {
    fontSize: SZ.sm,
    fontFamily: F.bold,
    color: C.blueDeep,
  },
  searchContainer: {
    paddingHorizontal: SP[3],
    paddingTop: 20,
  },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    padding: 16,
    fontSize: SZ.sm,
    color: C.ink,
    fontFamily: F.mono,
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.18)',
    marginBottom: 16,
  },
  searchBtn: {
    backgroundColor: C.blueDeep,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  searchBtnDisabled: {
    opacity: 0.5,
  },
  searchBtnText: {
    fontSize: SZ.sm,
    fontFamily: F.bold,
    color: '#ffffff',
  },
});
