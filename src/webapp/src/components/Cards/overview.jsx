import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import AddIcon from '@mui/icons-material/Add';
import CardsList from './list';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Fab from '@mui/material/Fab';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
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
  // The search term arrives from a conflict, which leads here with the card id.
  const [search, setSearch] = useState(() => searchParams.get('search') || '');

  const openRegisterCard = () => {
    navigate('register');
  };

  const openBulk = () => {
    navigate('bulk');
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
        <Grid container size={12} sx={{ justifyContent: 'flex-end' }}>
          <Button
            onClick={openBulk}
            sx={{ width: { md: 'auto', xs: '100%' } }}
            variant="outlined"
          >
            {t('cards.overview.start-bulk')}
          </Button>
        </Grid>
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
        aria-label={t('cards.overview.register-card')}
        color="primary"
        onClick={openRegisterCard}
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
    </Grid>
  );
};

export default CardsOverview;
