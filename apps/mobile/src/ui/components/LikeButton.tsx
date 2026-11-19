import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { toggleLike, useIsLiked, type AppTrack } from '@/core';

import { attempt } from '../actions';
import { haptics } from '../haptics';
import { useColors } from '../theme';
import { IconButton } from './IconButton';

export function LikeButton({ track, size = 24 }: { track: AppTrack; size?: number }) {
  const colors = useColors();
  const liked = useIsLiked(track.key);
  const pop = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  return (
    <Animated.View style={style}>
      <IconButton
        icon={liked ? 'heart' : 'heart-outline'}
        label={liked ? 'Remove from Liked' : 'Like'}
        size={size}
        color={liked ? colors.accentText : colors.text}
        onPress={() => {
          if (!liked) {
            haptics.success();
            pop.set(withSequence(withTiming(1.3, { duration: 110 }), withSpring(1, { damping: 8, stiffness: 260 })));
          } else {
            haptics.tap();
          }
          void attempt(toggleLike(track));
        }}
      />
    </Animated.View>
  );
}
