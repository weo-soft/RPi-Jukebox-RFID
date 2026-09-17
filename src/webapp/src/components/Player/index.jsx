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
        backgroundImage,
        backgroundPosition: 'center',
      }}
    >
      <Box
        data-testid="player-backdrop"
        sx={{
          // The blur costs GPU time on the Raspberry Pi and is pointless without
          // a cover image; the gradient alone carries the readability.
          backdropFilter: coverImage ? 'blur(14px)' : 'none',
          columnGap: 'var(--space-6)',
          display: 'grid',
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
