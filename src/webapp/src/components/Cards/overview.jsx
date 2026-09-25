import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import AddIcon from '@mui/icons-material/Add';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import CardsList from './list';
import CircularProgress from '@mui/material/CircularProgress';
import Fab from '@mui/material/Fab';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import Header from '../Header';
import request from '../../utils/request';

const CardsOverview = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const [data, setData] = useState({});
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGrouped, setIsGrouped] = useState(true);
  const [registerMenuAnchor, setRegisterMenuAnchor] = useState(null);
  // The search term arrives from a conflict, which leads here with the card id.
  const [search, setSearch] = useState(() => searchParams.get('search') || '');

  const closeRegisterMenu = () => setRegisterMenuAnchor(null);

  // One entry, three ways: this one card, a run over many cards, or one card
  // whose album is picked from the library.
  const register = (to) => {
    closeRegisterMenu();
    navigate(to);
  };

  useEffect(() => {
    const loadCardList = async () => {
      setIsLoading(true);
      const { result, error } = await request('cardsList');
      setIsLoading(false);

      if(result) setData(result);
      if(error) setError(error);
    }

    loadCardList();
  }, []);

  return (
    <Grid container id="cards" size={12}>
      <Header title={t('cards.overview.cards')} />
      <Grid
        container
        size={12}
        spacing={1}
        sx={{
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Grid size={12}>
          <TextField
            fullWidth
            id="cards-search"
            label={t('cards.list.search')}
            onChange={(event) => setSearch(event.target.value)}
            value={search}
            variant="outlined"
          />
        </Grid>
        <Grid size={12}>
          <FormControlLabel
            control={
              <Switch
                checked={isGrouped}
                onChange={(event) => setIsGrouped(event.target.checked)}
              />
            }
            label={t('cards.list.group-by-source')}
          />
        </Grid>
        {isLoading
          ? <CircularProgress />
          : <CardsList cardsList={data} isGrouped={isGrouped} search={search} />
        }
        {error &&
          <Typography>{t('cards.overview.loading-error')}</Typography>
        }
      </Grid>
      <Fab
        aria-controls={registerMenuAnchor ? 'cards-register-menu' : undefined}
        aria-expanded={Boolean(registerMenuAnchor)}
        aria-haspopup="menu"
        aria-label={t('cards.overview.register-card')}
        color="primary"
        onClick={(event) => setRegisterMenuAnchor(event.currentTarget)}
        sx={{
          bottom: 'calc(var(--nav-height) + var(--space-4))',
          height: 'var(--touch-secondary)',
          minHeight: 'var(--touch-secondary)',
          position: 'fixed',
          right: 'var(--gutter)',
          width: 'var(--touch-secondary)',
        }}
      >
        <AddIcon />
      </Fab>
      <Menu
        anchorEl={registerMenuAnchor}
        id="cards-register-menu"
        onClose={closeRegisterMenu}
        open={Boolean(registerMenuAnchor)}
      >
        <MenuItem onClick={() => register('register')}>
          <ListItemIcon><AddIcon /></ListItemIcon>
          <ListItemText>{t('cards.overview.register-single')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => register('bulk')}>
          <ListItemIcon><PlaylistPlayIcon /></ListItemIcon>
          <ListItemText>{t('cards.overview.register-bulk')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => register('bulk?mode=free')}>
          <ListItemIcon><LibraryMusicIcon /></ListItemIcon>
          <ListItemText>{t('cards.overview.register-pick')}</ListItemText>
        </MenuItem>
      </Menu>
    </Grid>
  );
};

export default CardsOverview;
