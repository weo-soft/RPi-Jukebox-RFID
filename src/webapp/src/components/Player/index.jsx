import { useContext, useEffect, useState } from 'react';

import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

import Cover from './cover';
import Controls from './controls';
import Display from './display';
import SeekBar from './seekbar';
import Volume from './volume';

import AppSettingsContext from '../../context/appsettings/context';
import PlayerContext from '../../context/player/context';
import request from '../../utils/request';

const BACKDROP_GRADIENT =
  'linear-gradient(to bottom, rgba(18, 18, 18, 0.5), rgba(18, 18, 18, 1))';

const Player = () => {
  const theme = useTheme();
  const { state: { playerstatus } } = useContext(PlayerContext);
  const { cover_url, file, provider } = playerstatus || {};
  const hasSong = Boolean(playerstatus?.songid);

  const [coverImage, setCoverImage] = useState(undefined);
  const [isCoverLoading, setIsCoverLoading] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState('none');

  const {
    settings,
  } = useContext(AppSettingsContext);

  const { show_covers } = settings;

  useEffect(() => {
    let isCurrent = true;

    const getCoverArt = async () => {
      const { result } = await request('getSingleCoverArt', {
        song_url: file,
        provider,
      });
      if (!isCurrent) return;
      if (result) {
        const cover = result.startsWith('http') ? result : `/cover-cache/${result}`;
        setCoverImage(cover);
        setBackgroundImage(`${BACKDROP_GRADIENT}, url(${cover})`);
      }
      setIsCoverLoading(false);
    };

    setCoverImage(undefined);
    setBackgroundImage('none');
    if (cover_url && show_covers) {
      setCoverImage(cover_url);
      setBackgroundImage(`${BACKDROP_GRADIENT}, url(${cover_url})`);
      setIsCoverLoading(false);
    }
    else if (file && show_covers) {
      setIsCoverLoading(true);
      getCoverArt();
    }
    else {
      setIsCoverLoading(false);
    }

    return () => {
      isCurrent = false;
    };
  }, [cover_url, file, provider, show_covers]);

  return (
    <Box
      id="player"
      sx={{
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* The blurred cover is its own layer instead of a backdrop-filter. A
          filtered backdrop covers whole device pixels only, so the fraction of
          a row that a layout of fractional sizes leaves over stays sharp and
          shows the cover at the edge. The layer reaches past the container and
          is clipped by it, which keeps its blurred edge out of sight. */}
      {coverImage &&
        <Box
          aria-hidden="true"
          data-testid="player-backdrop-blur"
          sx={{
            backgroundImage,
            backgroundPosition: 'center',
            filter: 'blur(var(--backdrop-blur))',
            inset: 'calc(-1 * var(--backdrop-spread))',
            position: 'absolute',
          }}
        />
      }
      <Box
        data-testid="player-backdrop"
        sx={{
          columnGap: 'var(--space-6)',
          display: 'grid',
          // Positioned as well, so it paints above the blurred layer.
          position: 'relative',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gridTemplateRows: 'minmax(0, 1fr)',
          height: 'calc(100dvh - var(--nav-height) - 2 * var(--gutter))',
          rowGap: 'var(--gap-block)',
          // landscape: the cover sits beside the controls
          [theme.breakpoints.up('md')]: {
            gridTemplateColumns: 'minmax(0, 42fr) minmax(0, 58fr)',
          },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'grid',
            // The column has to be definite: the cover square takes its width
            // from a percentage, which would otherwise collapse on a placeholder
            // without intrinsic size.
            gridTemplateColumns: 'minmax(0, 1fr)',
            justifyContent: 'center',
            justifyItems: 'center',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <Cover
            coverImage={coverImage}
            dimmed={!hasSong}
            isLoading={isCoverLoading}
          />
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: 0,
            minWidth: 0,
            // The volume row ends at the bottom of the inner height, so only the
            // top gets a little breathing room.
            paddingTop: 'var(--space-2)',
          }}
        >
          <Display />
          <SeekBar />
          <Controls />
          <Volume />
        </Box>
      </Box>
    </Box>
  );
};

export default Player;
