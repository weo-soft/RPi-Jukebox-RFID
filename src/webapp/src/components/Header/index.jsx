import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import IconButton from '@mui/material/IconButton';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

/*
 * A screen header: a title and, where the screen has somewhere to go back to,
 * an arrow. A screen that keeps its states inside itself steps back through
 * 'onBack'; a screen that is a route of its own leaves through 'backLink'.
 */
const Header = ({ title, backLink, onBack }) => {
  const { t } = useTranslation();

  const backProps = onBack
    ? { onClick: onBack }
    : { component: Link, nativeButton: false, to: backLink };

  return (
    <Grid
      container
      size={12}
      spacing={1}
      sx={{
        alignItems: 'center',
        backgroundColor: 'background.default',
        minHeight: 56,
        position: 'sticky',
        top: 0,
        zIndex: 2,
      }}
    >
      {(backLink || onBack) &&
        <IconButton
          aria-label={t('header.back')}
          {...backProps}
          sx={{
            height: 'var(--touch-comfort)',
            minHeight: 'var(--touch-comfort)',
            minWidth: 'var(--touch-comfort)',
            width: 'var(--touch-comfort)',
          }}
          title={t('header.back')}
        >
          <ArrowBackIcon />
        </IconButton>
      }
      <Typography component="h2" variant="sectionTitle">
        {title}
      </Typography>
    </Grid>
  );
};

export default Header;
